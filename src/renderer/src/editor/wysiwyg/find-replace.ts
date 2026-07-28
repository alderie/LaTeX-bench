// Find and replace in the rich view, over the document rather than the DOM.
//
// This used to be `window.find`: Chromium's own text search, which walks
// what is painted. That meant no replace at all, no match count, and — the
// part that actually loses you an edit — no visibility into anything not
// currently rendered as text. The preamble is a collapsed node view. A
// formula's LaTeX lives in an attribute. A `\newcommand` inside a raw block
// is a string on a node. `window.find` could see none of it, so "replace
// \eps with \varepsilon everywhere" silently missed every formula in the
// paper, which is where all of them were.
//
// Searching the ProseMirror document instead makes all of that reachable,
// because the document holds it whether or not the screen does.

import {
  Plugin,
  PluginKey,
  NodeSelection,
  TextSelection,
  type Transaction
} from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import {
  MATCH_LIMIT,
  NO_MATCHES,
  regexError,
  type FindOptions,
  type MatchSummary
} from '../source/search-model'

/**
 * Node attributes that hold text worth searching.
 *
 * Everything here is LaTeX the author wrote and can reasonably want to
 * change in bulk — a macro name, an environment, a citation key — and none
 * of it is reachable as document text.
 */
const SEARCHABLE_ATTRS: Record<string, string[]> = {
  preamble: ['source'],
  rawLatex: ['source'],
  rawInline: ['source'],
  mathBlock: ['latex'],
  mathInline: ['latex'],
  codeBlock: ['code'],
  footnote: ['source'],
  figure: ['caption']
}

/** Stands in for a non-text inline node, whose PM size is exactly 1. */
const ATOM_PLACEHOLDER = '￼'

export interface RichMatch {
  kind: 'text' | 'attr'
  /** Document range: the matched text, or the node holding the attribute. */
  from: number
  to: number
  /** Attribute matches only. */
  nodePos?: number
  attr?: string
  attrFrom?: number
  attrTo?: number
  /** Capture groups, kept so `$1` in the replacement can be expanded later. */
  groups: string[]
  /** What the match is inside — shown so an attr hit isn't a mystery. */
  context: string
}

// ── Matching ───────────────────────────────────────────────────────────

/**
 * The query as a regex.
 *
 * Returns null for an empty or unusable query, which is how "stop
 * highlighting" is expressed. `u` is deliberately absent: it makes stray
 * escapes in a half-typed pattern throw, and a find field is typed into one
 * character at a time.
 */
export function buildMatcher(query: string, options: FindOptions): RegExp | null {
  if (!query) return null
  let source = options.regexp ? query : escapeRegExp(query)
  if (options.wholeWord) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A textblock's inline content as a string whose indices are PM offsets.
 *
 * Text nodes contribute their characters and every other inline node
 * contributes exactly one placeholder, which is also exactly its PM size —
 * so index `i` in the result is always document position `pos + 1 + i`, with
 * no mapping table to get out of step.
 */
function inlineTextOf(node: PMNode): string {
  let out = ''
  node.forEach((child) => {
    if (child.isText) out += child.text ?? ''
    else out += ATOM_PLACEHOLDER.repeat(child.nodeSize)
  })
  return out
}

/** Human-readable name for the thing a match is inside. */
function contextLabel(nodeName: string, attr: string): string {
  switch (nodeName) {
    case 'preamble':
      return 'preamble'
    case 'mathBlock':
    case 'mathInline':
      return 'formula'
    case 'codeBlock':
      return 'code'
    case 'rawLatex':
    case 'rawInline':
      return 'raw LaTeX'
    case 'footnote':
      return 'footnote'
    case 'figure':
      return attr === 'caption' ? 'caption' : 'figure'
    default:
      return nodeName
  }
}

/**
 * Every match in the document, in document order.
 *
 * Capped for the same reason the source view's counter is: a `.` in regex
 * mode over a long paper is a query someone types by accident on the way to
 * something else, and it should cost a bounded amount.
 */
export function findRichMatches(
  doc: PMNode,
  query: string,
  options: FindOptions,
  limit = MATCH_LIMIT
): RichMatch[] {
  const matcher = buildMatcher(query, options)
  if (!matcher) return []
  const out: RichMatch[] = []

  const scan = (text: string, onMatch: (m: RegExpExecArray) => void): void => {
    matcher.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = matcher.exec(text)) !== null) {
      onMatch(match)
      if (out.length >= limit) return
      // A pattern that can match nothing (`a*`) would otherwise never
      // advance and spin here forever.
      if (match[0].length === 0) matcher.lastIndex++
    }
  }

  doc.descendants((node, pos) => {
    if (out.length >= limit) return false

    if (node.isTextblock) {
      const text = inlineTextOf(node)
      scan(text, (match) => {
        // A match that is only placeholders is a match on nothing.
        if (match[0].length > 0 && !match[0].replace(/￼/g, '')) return
        out.push({
          kind: 'text',
          from: pos + 1 + match.index,
          to: pos + 1 + match.index + match[0].length,
          groups: match.slice(1).map((g) => g ?? ''),
          context: node.type.name
        })
      })
    }

    const attrs = SEARCHABLE_ATTRS[node.type.name]
    if (attrs) {
      for (const attr of attrs) {
        const value = node.attrs[attr]
        if (typeof value !== 'string' || !value) continue
        scan(value, (match) => {
          out.push({
            kind: 'attr',
            from: pos,
            to: pos + node.nodeSize,
            nodePos: pos,
            attr,
            attrFrom: match.index,
            attrTo: match.index + match[0].length,
            groups: match.slice(1).map((g) => g ?? ''),
            context: contextLabel(node.type.name, attr)
          })
        })
      }
    }
    return true
  })

  // `descendants` visits a parent before its children, so a paragraph's text
  // matches arrive before an inline formula that sits earlier in it.
  return out.sort((a, b) => a.from - b.from || (a.attrFrom ?? -1) - (b.attrFrom ?? -1))
}

/** Expand `$1`, `$&` and `$$` in a replacement template. */
export function expandReplacement(template: string, groups: string[], matched: string): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (_all, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return matched
    const index = Number(token)
    return groups[index - 1] ?? ''
  })
}

// ── The plugin ─────────────────────────────────────────────────────────

interface RichFindState {
  query: string
  options: FindOptions
  matches: RichMatch[]
  /** Index of the match the user is standing on; -1 when none. */
  current: number
  decorations: DecorationSet
}

const EMPTY_OPTIONS: FindOptions = {
  caseSensitive: false,
  regexp: false,
  wholeWord: false
}

const EMPTY_STATE: RichFindState = {
  query: '',
  options: EMPTY_OPTIONS,
  matches: [],
  current: -1,
  decorations: DecorationSet.empty
}

export const richFindKey = new PluginKey<RichFindState>('richFind')

interface RichFindMeta {
  query?: string
  options?: FindOptions
  current?: number
}

function decorate(doc: PMNode, matches: RichMatch[], current: number): DecorationSet {
  const decorations: Decoration[] = []
  matches.forEach((match, index) => {
    const active = index === current
    if (match.kind === 'text') {
      decorations.push(
        Decoration.inline(match.from, match.to, {
          class: 'rich-find-match' + (active ? ' rich-find-match--current' : '')
        })
      )
    } else {
      // We can't draw inside an attribute, so the node that holds it is
      // marked instead — which is honest about what was found and where.
      decorations.push(
        Decoration.node(match.from, match.to, {
          class: 'rich-find-node' + (active ? ' rich-find-node--current' : '')
        })
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

function recompute(
  doc: PMNode,
  query: string,
  options: FindOptions,
  preferredCurrent: number
): RichFindState {
  const matches = query ? findRichMatches(doc, query, options) : []
  const current =
    matches.length === 0 ? -1 : Math.min(Math.max(0, preferredCurrent), matches.length - 1)
  return {
    query,
    options,
    matches,
    current,
    decorations: decorate(doc, matches, current)
  }
}

export function richFind(): Plugin<RichFindState> {
  return new Plugin<RichFindState>({
    key: richFindKey,
    state: {
      init: () => EMPTY_STATE,
      apply(tr, value) {
        const meta = tr.getMeta(richFindKey) as RichFindMeta | undefined
        if (meta) {
          const query = meta.query ?? value.query
          const options = meta.options ?? value.options
          if (meta.current !== undefined && query === value.query && options === value.options) {
            // Stepping through the results we already have.
            const current = value.matches.length
              ? (meta.current + value.matches.length) % value.matches.length
              : -1
            return {
              ...value,
              current,
              decorations: decorate(tr.doc, value.matches, current)
            }
          }
          return recompute(tr.doc, query, options, meta.current ?? 0)
        }
        if (!tr.docChanged) return value
        if (!value.query) return value
        // Positions move under us on every edit — including the edits
        // *replace* itself makes — so the set is rebuilt rather than mapped.
        return recompute(tr.doc, value.query, value.options, value.current)
      }
    },
    props: {
      decorations: (state) => richFindKey.getState(state)?.decorations ?? DecorationSet.empty
    }
  })
}

// ── The facade the find widget drives ──────────────────────────────────

function stateOf(view: EditorView): RichFindState {
  return richFindKey.getState(view.state) ?? EMPTY_STATE
}

/** Push a query into the editor and report what it found. */
export function richSearch(view: EditorView, query: string, options: FindOptions): MatchSummary {
  if (options.regexp) {
    const error = regexError(query)
    if (error) {
      view.dispatch(view.state.tr.setMeta(richFindKey, { query: '', options }))
      return { ...NO_MATCHES, error }
    }
  }
  view.dispatch(
    view.state.tr.setMeta(richFindKey, {
      query,
      options,
      current: currentOf(view)
    })
  )
  return summarize(view)
}

function currentOf(view: EditorView): number {
  const current = stateOf(view).current
  return current < 0 ? 0 : current
}

/** The current count, without touching the query — for a recount on edit. */
export function richSummary(view: EditorView): MatchSummary {
  return summarize(view)
}

function summarize(view: EditorView): MatchSummary {
  const { matches, current } = stateOf(view)
  return {
    count: matches.length,
    current: current >= 0 && matches.length > 0 ? current + 1 : 0,
    capped: matches.length >= MATCH_LIMIT,
    // The rich view has no line numbers; the minimap that consumes these
    // only exists in the source view.
    lines: [],
    error: null
  }
}

/** Move to the next (or previous) match and put the selection on it. */
export function richStep(view: EditorView, backwards: boolean): MatchSummary {
  const { matches, current } = stateOf(view)
  if (matches.length === 0) return summarize(view)
  const next = current < 0 ? (backwards ? matches.length - 1 : 0) : current + (backwards ? -1 : 1)
  view.dispatch(view.state.tr.setMeta(richFindKey, { current: next }))
  revealCurrent(view)
  return summarize(view)
}

/** Select the current match, so the caret is where the highlight is. */
function revealCurrent(view: EditorView): void {
  const { matches, current } = stateOf(view)
  const match = matches[current]
  if (!match) return
  const tr = view.state.tr
  try {
    if (match.kind === 'text') {
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to))
    } else {
      // An attribute match can't be selected as text; selecting the node
      // that holds it scrolls a collapsed preamble or a formula into view,
      // which is the thing `window.find` could never do.
      tr.setSelection(NodeSelection.create(tr.doc, match.from))
    }
  } catch {
    return
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** Replace the current match, then move to the next one. */
export function richReplace(view: EditorView, replacement: string): MatchSummary {
  const { matches, current } = stateOf(view)
  const match = matches[current]
  if (!match) return richStep(view, false)
  const tr = view.state.tr
  applyOne(tr, match, replacement)
  view.dispatch(tr)
  // The set was rebuilt by the transaction; land on the match that has
  // taken this one's place rather than skipping it.
  view.dispatch(view.state.tr.setMeta(richFindKey, { current }))
  revealCurrent(view)
  return summarize(view)
}

/** Replace every match in one transaction, so one undo takes it all back. */
export function richReplaceAll(view: EditorView, replacement: string): MatchSummary {
  const { matches } = stateOf(view)
  if (matches.length === 0) return summarize(view)
  const tr = view.state.tr

  // Attribute edits first: they rewrite a string on a node and never change
  // a document position, so the text offsets stay valid afterwards.
  const byAttr = new Map<string, RichMatch[]>()
  for (const match of matches) {
    if (match.kind !== 'attr') continue
    const key = `${match.nodePos}:${match.attr}`
    const list = byAttr.get(key)
    if (list) list.push(match)
    else byAttr.set(key, [match])
  }
  for (const group of byAttr.values()) {
    const first = group[0]
    const node = tr.doc.nodeAt(first.nodePos!)
    if (!node) continue
    let value = node.attrs[first.attr!] as string
    // Right to left, so an earlier match's offsets aren't shifted by a
    // later replacement of a different length.
    for (const match of [...group].sort((a, b) => b.attrFrom! - a.attrFrom!)) {
      const matched = value.slice(match.attrFrom!, match.attrTo!)
      value =
        value.slice(0, match.attrFrom!) +
        expandReplacement(replacement, match.groups, matched) +
        value.slice(match.attrTo!)
    }
    tr.setNodeMarkup(first.nodePos!, undefined, {
      ...node.attrs,
      [first.attr!]: value
    })
  }

  // Then the text, last to first, for the same reason.
  const textMatches = matches.filter((m) => m.kind === 'text').sort((a, b) => b.from - a.from)
  for (const match of textMatches) {
    const matched = tr.doc.textBetween(match.from, match.to, ATOM_PLACEHOLDER, ATOM_PLACEHOLDER)
    const text = expandReplacement(replacement, match.groups, matched)
    if (text) tr.insertText(text, match.from, match.to)
    else tr.delete(match.from, match.to)
  }

  view.dispatch(tr)
  return summarize(view)
}

function applyOne(tr: Transaction, match: RichMatch, replacement: string): void {
  if (match.kind === 'attr') {
    const node = tr.doc.nodeAt(match.nodePos!)
    if (!node) return
    const value = node.attrs[match.attr!] as string
    const matched = value.slice(match.attrFrom!, match.attrTo!)
    const next =
      value.slice(0, match.attrFrom!) +
      expandReplacement(replacement, match.groups, matched) +
      value.slice(match.attrTo!)
    tr.setNodeMarkup(match.nodePos!, undefined, {
      ...node.attrs,
      [match.attr!]: next
    })
    return
  }
  const matched = tr.doc.textBetween(match.from, match.to, ATOM_PLACEHOLDER, ATOM_PLACEHOLDER)
  const text = expandReplacement(replacement, match.groups, matched)
  if (text) tr.insertText(text, match.from, match.to)
  else tr.delete(match.from, match.to)
}

/** Stop highlighting — what closing the widget does. */
export function richClear(view: EditorView): void {
  if (!stateOf(view).query) return
  view.dispatch(view.state.tr.setMeta(richFindKey, { query: '' }))
}

/** The label for the current match's context, for the widget's hint. */
export function richCurrentContext(view: EditorView): string {
  const { matches, current } = stateOf(view)
  const match = matches[current]
  if (!match || match.kind !== 'attr') return ''
  return match.context
}
