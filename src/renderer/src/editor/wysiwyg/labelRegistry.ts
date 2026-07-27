import { Node as PMNode } from 'prosemirror-model'

// A document-wide registry of label → resolved cross-reference text plus
// per-mathBlock equation numbers. Rebuilt from scratch on every doc
// transaction; node views subscribe to be notified when the table
// changes so they can re-render with the new numbering.

export type LabelKind =
  | 'section'
  | 'theorem'
  | 'equation'
  | 'figure'
  | 'table'
  | 'algorithm'
  | 'unknown'

export interface ResolvedLabel {
  kind: LabelKind
  // Raw counter value, e.g. "3.1", "1", or "(2)" for equations.
  number: string
  // Text used by `\ref` (just the number).
  shortNumber: string
  // Text used by `\eqref` — equations get "(N)", everything else "N".
  eqrefText: string
  // Text used by `\cref` — "Theorem 3.1", "Equation (1)", etc.
  pretty: string
  // DOM id consumers can scroll to with a plain `<a href="#…">`.
  domAnchor: string
  // The kind word we put in front for cleveref (singular form, capitalised
  // because the test paper uses `[capitalise]`).
  kindLabel: string
}

export interface ResolvedCitation {
  // 1-based index in the bibliography.
  number: number
  // Best-effort short label for inline display, e.g. "Smith et al., 2020".
  // Falls back to "[N]" when we can't extract a sensible author/year.
  shortLabel: string
  domAnchor: string
}

export interface RegistryState {
  byKey: Map<string, ResolvedLabel>
  citations: Map<string, ResolvedCitation>
  // For each numbered math block, the per-line tag strings. Indexed by the
  // block's position (the value getPos() returns inside its NodeView).
  // null entries mark unnumbered lines (`\nonumber`/`\notag`/`*`-variants).
  equationNumbersByPos: Map<number, Array<string | null>>
  // Caption prefix for each numbered float ("Table", "1"), keyed by the
  // float node's absolute position so its caption can render "Table 1: …".
  floatNumbersByPos: Map<number, FloatNumber>
}

export interface FloatNumber {
  kindLabel: string
  number: string
}

const emptyState = (): RegistryState => ({
  byKey: new Map(),
  citations: new Map(),
  equationNumbersByPos: new Map(),
  floatNumbersByPos: new Map()
})

let state: RegistryState = emptyState()
const listeners = new Set<() => void>()

export function getState(): RegistryState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const l of listeners) {
    try {
      l()
    } catch (err) {
      // A misbehaving subscriber shouldn't break renumbering for the rest.
      console.error('[labelRegistry] subscriber threw', err)
    }
  }
}

interface BuildContext {
  byKey: Map<string, ResolvedLabel>
  citations: Map<string, ResolvedCitation>
  equationNumbersByPos: Map<number, Array<string | null>>
  floatNumbersByPos: Map<number, FloatNumber>
  // Counters
  sectionCounters: number[] // index = level - 1
  theoremCounter: number // shared across all theorem-like envs (via [theorem])
  equationCounter: number
  figureCounter: number
  tableCounter: number
  algorithmCounter: number
  bibitemCounter: number
  // After \appendix, sections are lettered (A, B, …) instead of numbered.
  inAppendix: boolean
}

function makeContext(): BuildContext {
  return {
    byKey: new Map(),
    citations: new Map(),
    equationNumbersByPos: new Map(),
    floatNumbersByPos: new Map(),
    sectionCounters: [0, 0, 0],
    theoremCounter: 0,
    equationCounter: 0,
    figureCounter: 0,
    tableCounter: 0,
    algorithmCounter: 0,
    bibitemCounter: 0,
    inAppendix: false
  }
}

const KIND_LABEL: Record<LabelKind, string> = {
  section: 'Section',
  theorem: 'Theorem',
  equation: 'Equation',
  figure: 'Figure',
  table: 'Table',
  algorithm: 'Algorithm',
  unknown: ''
}

// floatBlock kinds that carry their own counter. Layout-only wrappers
// (`center`, `minipage`, `abstract`) are deliberately absent — they aren't
// numbered and shouldn't consume a number if they happen to be labelled.
const FLOAT_KINDS: Record<string, LabelKind> = {
  table: 'table',
  'table*': 'table',
  sidewaystable: 'table',
  wraptable: 'table',
  figure: 'figure',
  'figure*': 'figure',
  sidewaysfigure: 'figure',
  wrapfigure: 'figure',
  subfigure: 'figure',
  algorithm: 'algorithm',
  'algorithm*': 'algorithm',
  listing: 'algorithm',
  'listing*': 'algorithm'
}

// Per-environment kind label override for theorem-like envs. The schema
// stores `kind: 'theorem' | 'lemma' | …` on the theoremEnv node; we
// surface that as the cleveref label.
const THEOREM_KIND_LABELS: Record<string, string> = {
  theorem: 'Theorem',
  lemma: 'Lemma',
  proposition: 'Proposition',
  corollary: 'Corollary',
  definition: 'Definition',
  assumption: 'Assumption',
  conjecture: 'Conjecture',
  remark: 'Remark',
  example: 'Example',
  observation: 'Observation',
  fact: 'Fact',
  claim: 'Claim',
  note: 'Note',
  proof: 'Proof'
}

export function anchorFor(key: string): string {
  return `latex-anchor-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function registerLabel(
  ctx: BuildContext,
  key: string | null | undefined,
  resolved: Omit<ResolvedLabel, 'domAnchor'>,
  anchorKey?: string
): void {
  if (!key) return
  // Multiple labels can refer to the same node (e.g. a section with two
  // \label{}s). They all resolve to the same DOM anchor — the first
  // label's id — so navigation lands on the same element.
  const anchor = anchorFor(anchorKey ?? key)
  ctx.byKey.set(key, { ...resolved, domAnchor: anchor })
}

// Parse a math block's latex string and figure out:
//   - is the env starred (unnumbered)?
//   - which "environment kind" is it (equation, align, gather, multline)?
//   - how many lines does it produce?
//   - which of those lines have \nonumber or \notag?
//   - any \label{key} on each line.
//
// We return an array of {label, numbered} entries — one per logical line.
// `numbered` is false when the env is starred OR the line carries
// \nonumber/\notag. Lines without numbers don't bump the counter and
// don't get a tag injected.
interface MathLine {
  label: string | null
  numbered: boolean
}

function splitMathLines(body: string): string[] {
  // Split on top-level `\\` (two backslashes) the same way tabular does.
  const out: string[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        out.push(body.slice(last, i))
        i += 2
        // Skip optional `[Npt]` spacer.
        while (i < body.length && /\s/.test(body[i])) i++
        if (body[i] === '[') {
          const close = body.indexOf(']', i)
          if (close !== -1) i = close + 1
        }
        last = i
        continue
      }
      if (body[i + 1] === '{' || body[i + 1] === '}') {
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  out.push(body.slice(last))
  return out
}

const PER_LINE_NUMBERED_ENVS = new Set([
  'align',
  'gather',
  'multline',
  'eqnarray',
  'alignat',
  'flalign',
  'xalignat',
  'IEEEeqnarray'
])
const SINGLE_NUMBERED_ENVS = new Set(['equation'])

interface MathLines {
  kind: 'numbered' | 'starred' | 'plain'
  lines: MathLine[]
  // `\begin{subequations}` numbers its whole group once and letters the
  // lines inside it: (1a), (1b), (1c). Flagged here so the caller consumes
  // a single equation number for the group.
  lettered?: boolean
}

function parseMathLines(latex: string): MathLines {
  const trimmed = latex.trim()
  // \[ ... \] is unnumbered.
  if (/^\\\[[\s\S]*\\\]$/.test(trimmed)) {
    return { kind: 'plain', lines: [] }
  }
  const envMatch = /^\\begin\{([a-zA-Z]+\*?)\}([\s\S]*)\\end\{\1\}$/.exec(trimmed)
  if (!envMatch) return { kind: 'plain', lines: [] }
  const envName = envMatch[1]
  const body = envMatch[2]
  const isStarred = envName.endsWith('*')
  const baseName = isStarred ? envName.slice(0, -1) : envName
  if (isStarred) return { kind: 'starred', lines: [] }
  if (baseName === 'subequations') {
    // Number the group once and letter the inner lines. The body is one
    // nested display env (align/gather/…) preceded by an optional `\label`
    // for the group itself — drop that prefix so the nested environment is
    // what gets parsed. Only the prefix: the `\label`s *inside* the nested
    // environment are the per-line ones we're after.
    const innerStart = body.indexOf('\\begin{')
    const inner = parseMathLines(innerStart >= 0 ? body.slice(innerStart).trim() : body.trim())
    if (inner.kind !== 'numbered') return { kind: 'plain', lines: [] }
    return { kind: 'numbered', lines: inner.lines, lettered: true }
  }
  if (SINGLE_NUMBERED_ENVS.has(baseName)) {
    const label = extractLabelFromMathChunk(body)
    return { kind: 'numbered', lines: [{ label, numbered: true }] }
  }
  if (PER_LINE_NUMBERED_ENVS.has(baseName)) {
    const segments = splitMathLines(body)
    const lines = segments.map((seg) => {
      const label = extractLabelFromMathChunk(seg)
      const noNum = /\\nonumber\b|\\notag\b/.test(seg)
      const isEmpty = seg.trim().length === 0
      return { label, numbered: !noNum && !isEmpty }
    })
    return { kind: 'numbered', lines }
  }
  return { kind: 'plain', lines: [] }
}

function extractLabelFromMathChunk(chunk: string): string | null {
  const m = /\\label\{([^}]*)\}/.exec(chunk)
  return m ? m[1] : null
}

// ── Walking the PM doc ───────────────────────────────────────────────

// LaTeX numbers appendix chapters/sections with letters: A, B, … Z, AA…
function alphaCounter(n: number): string {
  let out = ''
  let k = n
  while (k > 0) {
    const rem = (k - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    k = Math.floor((k - 1) / 26)
  }
  return out || '0'
}

function walkSection(ctx: BuildContext, node: PMNode, _parentNumber: string): void {
  const level = (node.attrs.level as number) ?? 1
  const starred = (node.attrs.starred as boolean) ?? false
  if (!starred) {
    while (ctx.sectionCounters.length < level) ctx.sectionCounters.push(0)
    ctx.sectionCounters[level - 1]++
    for (let k = level; k < ctx.sectionCounters.length; k++) ctx.sectionCounters[k] = 0
  }
  const parts = ctx.sectionCounters.slice(0, level).map((c, i) => {
    // Only the top level goes alphabetic — `A`, `A.1`, `A.1.1`.
    if (ctx.inAppendix && i === 0) return alphaCounter(c)
    return String(c)
  })
  const number = starred ? '' : parts.join('.')

  const labels = (node.attrs.labels as string[] | undefined) ?? []
  const anchorKey = labels[0]
  // cleveref calls a top-level section after \appendix an "Appendix".
  const kindLabel = ctx.inAppendix && level === 1 ? 'Appendix' : KIND_LABEL.section
  for (const key of labels) {
    registerLabel(
      ctx,
      key,
      {
        kind: 'section',
        number,
        shortNumber: number,
        eqrefText: number,
        pretty: number ? `${kindLabel} ${number}` : '',
        kindLabel
      },
      anchorKey
    )
  }

  // Recurse children for nested sections / blocks.
  node.forEach((child) => walkBlock(ctx, child, number))
}

function walkTheorem(ctx: BuildContext, node: PMNode): void {
  ctx.theoremCounter++
  const sectionPrefix = ctx.sectionCounters[0] > 0 ? `${ctx.sectionCounters[0]}.` : ''
  const number = `${sectionPrefix}${ctx.theoremCounter}`
  const kind = (node.attrs.kind as string) || 'theorem'
  const kindLabel = THEOREM_KIND_LABELS[kind] ?? KIND_LABEL.theorem
  const key = node.attrs.label as string | null
  registerLabel(ctx, key, {
    kind: 'theorem',
    number,
    shortNumber: number,
    eqrefText: number,
    pretty: `${kindLabel} ${number}`,
    kindLabel
  })
}

function walkMathBlock(ctx: BuildContext, node: PMNode, pos: number): void {
  const latex = (node.attrs.latex as string) || ''
  const parsed = parseMathLines(latex)
  if (parsed.kind !== 'numbered') {
    ctx.equationNumbersByPos.set(pos, [])
    return
  }
  const tags: Array<string | null> = []
  // A subequations group consumes exactly one number; its lines are
  // distinguished by a trailing letter.
  const groupNumber = parsed.lettered ? String(++ctx.equationCounter) : null
  let letterIndex = 0
  if (groupNumber !== null) {
    // `\label` on the subequations env itself refers to the whole group.
    registerLabel(ctx, node.attrs.label as string | null, {
      kind: 'equation',
      number: `(${groupNumber})`,
      shortNumber: groupNumber,
      eqrefText: `(${groupNumber})`,
      pretty: `${KIND_LABEL.equation} (${groupNumber})`,
      kindLabel: KIND_LABEL.equation
    })
  }
  for (const line of parsed.lines) {
    if (line.numbered) {
      let num: string
      if (groupNumber !== null) {
        num = `${groupNumber}${String.fromCharCode(97 + letterIndex)}`
        letterIndex++
      } else {
        ctx.equationCounter++
        num = String(ctx.equationCounter)
      }
      tags.push(num)
      const fallbackKey = node.attrs.label as string | null
      // Prefer the per-line label, fall back to the node's primary label
      // (set when extractLabel found one at parse time).
      const key = line.label ?? (tags.length === 1 ? fallbackKey : null)
      registerLabel(ctx, key, {
        kind: 'equation',
        number: `(${num})`,
        shortNumber: num,
        eqrefText: `(${num})`,
        pretty: `${KIND_LABEL.equation} (${num})`,
        kindLabel: KIND_LABEL.equation
      })
    } else {
      tags.push(null)
    }
  }
  ctx.equationNumbersByPos.set(pos, tags)
}

function walkFigure(ctx: BuildContext, node: PMNode): void {
  ctx.figureCounter++
  const number = String(ctx.figureCounter)
  const key = node.attrs.label as string | null
  registerLabel(ctx, key, {
    kind: 'figure',
    number,
    shortNumber: number,
    eqrefText: number,
    pretty: `${KIND_LABEL.figure} ${number}`,
    kindLabel: KIND_LABEL.figure
  })
}

// `\begin{table}`/`\begin{algorithm}`/… — numbered per kind, and the
// source of the `??` cross-references that used to show up for
// `\cref{tab:…}` and `\cref{alg:…}`, since the whole float was one
// opaque raw block before and never registered its label.
function walkFloat(
  ctx: BuildContext,
  node: PMNode
): { kindLabel: string; number: string } | null {
  const kind = FLOAT_KINDS[(node.attrs.kind as string) ?? '']
  if (!kind) return null
  const number =
    kind === 'table'
      ? String(++ctx.tableCounter)
      : kind === 'figure'
        ? String(++ctx.figureCounter)
        : String(++ctx.algorithmCounter)
  const key = node.attrs.label as string | null
  const kindLabel = KIND_LABEL[kind]
  registerLabel(ctx, key, {
    kind,
    number,
    shortNumber: number,
    eqrefText: number,
    pretty: `${kindLabel} ${number}`,
    kindLabel
  })
  return { kindLabel, number }
}

function walkBibitem(ctx: BuildContext, node: PMNode): void {
  ctx.bibitemCounter++
  const key = (node.attrs.key as string) || ''
  if (!key) return
  const number = ctx.bibitemCounter
  // Try to derive a short author/year label by reading the first text run
  // of the bibitem. Conservative: if we can't pull out a clear author, we
  // fall back to "[N]".
  const shortLabel = deriveCitationShortLabel(node) ?? `[${number}]`
  ctx.citations.set(key, {
    number,
    shortLabel,
    domAnchor: anchorFor(key)
  })
}

function deriveCitationShortLabel(bibitem: PMNode): string | null {
  // Collect the inline text of the bibitem.
  let text = ''
  bibitem.forEach((child) => {
    if (child.isText) text += child.text ?? ''
    else if (child.type.name === 'mathInline') text += '$' // skip math
  })
  text = text.trim()
  if (!text) return null
  // Heuristic 1: leading author family-name pattern, then year in parens.
  // e.g. "Smith, J. (2020). Title…" or "Smith, J., Jones, K. (2020) …"
  const parenYear = /(.+?)\s*\((\d{4})[a-z]?\)/.exec(text)
  if (parenYear) {
    const authors = parenYear[1].replace(/\s+and\s+/g, ', ').trim()
    return formatAuthorYear(authors, parenYear[2])
  }
  // Heuristic 2: "Smith, J., Jones, K., 2020. Title…" (Elsevier style).
  const commaYear = /(.+?),\s*(\d{4})[a-z]?\.?\s/.exec(text)
  if (commaYear) {
    const authors = commaYear[1].replace(/\s+and\s+/g, ', ').trim()
    return formatAuthorYear(authors, commaYear[2])
  }
  return null
}

function formatAuthorYear(authorsStr: string, year: string): string {
  // Pick the first author family name. Family-name conventions vary —
  // we treat the segment before the first comma as the family name when
  // present, otherwise the first whitespace-separated token.
  const segs = authorsStr.split(/,\s*/).filter(Boolean)
  const firstFamily = segs[0]?.split(/\s+/)[0] ?? ''
  if (!firstFamily) return year
  const authorCount = segs.length
  if (authorCount >= 3) return `${firstFamily} et al., ${year}`
  if (authorCount === 2) {
    const secondFamily = segs[1]?.split(/\s+/)[0] ?? ''
    return secondFamily ? `${firstFamily} & ${secondFamily}, ${year}` : `${firstFamily}, ${year}`
  }
  return `${firstFamily}, ${year}`
}

function walkBlock(ctx: BuildContext, node: PMNode, parentNumber: string): void {
  switch (node.type.name) {
    case 'section':
      walkSection(ctx, node, parentNumber)
      return
    case 'theoremEnv':
      walkTheorem(ctx, node)
      // Theorems can contain mathBlocks; recurse their children too.
      node.forEach((child) => walkBlock(ctx, child, parentNumber))
      return
    case 'mathBlock':
      // We need the absolute position; resolve via descendantsWalker only.
      // walkBlock is not given a position — handled in the walker pass.
      return
    case 'figure':
    case 'floatBlock':
      // Numbered in the position-aware pass so captions can look up their
      // own "Table 1:" prefix; recurse for theorems nested inside a float.
      node.forEach((child) => walkBlock(ctx, child, parentNumber))
      return
    case 'rawLatex':
      // `\appendix` switches top-level section numbering to letters, so
      // \cref{app:proofs} reads "Appendix A" and not "Section 6".
      if (/^\s*\\appendix\b/.test((node.attrs.source as string) ?? '')) {
        ctx.inAppendix = true
        ctx.sectionCounters = ctx.sectionCounters.map(() => 0)
      }
      return
    case 'bibliography':
      node.forEach((child) => {
        if (child.type.name === 'bibitem') walkBibitem(ctx, child)
      })
      return
    default:
      node.forEach((child) => walkBlock(ctx, child, parentNumber))
  }
}

export function rebuild(doc: PMNode): void {
  const ctx = makeContext()

  // First pass for non-math blocks (sections, theorems, figures). They
  // bump counters in document order.
  doc.forEach((child) => walkBlock(ctx, child, ''))

  // Second pass for nodes that need their absolute position: equations
  // (per-line tags) and floats (so a caption can render "Table 1:").
  // Both are numbered in document order, independent of sections, so a
  // separate pass is safe.
  ctx.equationCounter = 0
  doc.descendants((node, pos) => {
    if (node.type.name === 'mathBlock') {
      walkMathBlock(ctx, node, pos)
      return false // don't descend (atom anyway)
    }
    if (node.type.name === 'figure') {
      walkFigure(ctx, node)
      ctx.floatNumbersByPos.set(pos, {
        kindLabel: KIND_LABEL.figure,
        number: String(ctx.figureCounter)
      })
      return false
    }
    if (node.type.name === 'floatBlock') {
      const before = walkFloat(ctx, node)
      if (before) ctx.floatNumbersByPos.set(pos, before)
      return true
    }
    return true
  })

  state = {
    byKey: ctx.byKey,
    citations: ctx.citations,
    equationNumbersByPos: ctx.equationNumbersByPos,
    floatNumbersByPos: ctx.floatNumbersByPos
  }

  // Only wake the subscribers when the numbering actually moved.
  //
  // Every math node view subscribes, and every notification re-runs KaTeX on
  // its formula. Typing a character in a paragraph shifts document positions
  // but changes no number, so an unconditional notify re-rendered every
  // equation in the paper on every keystroke — the single largest source of
  // typing lag in a maths-heavy document.
  const signature = signatureOf(state)
  if (signature !== lastSignature) {
    lastSignature = signature
    notify()
  }
}

let lastSignature = ''

// Cheap structural fingerprint of everything a subscriber can observe.
// Positions are included because a node view looks its numbering up *by*
// position, so a pure position shift still has to reach it.
function signatureOf(s: RegistryState): string {
  const parts: string[] = []
  for (const [key, ref] of s.byKey) parts.push(`${key}=${ref.pretty}`)
  for (const [key, cite] of s.citations) parts.push(`${key}#${cite.number}`)
  for (const [pos, tags] of s.equationNumbersByPos) parts.push(`${pos}:${tags.join('|')}`)
  for (const [pos, num] of s.floatNumbersByPos) parts.push(`${pos}@${num.kindLabel}${num.number}`)
  return parts.join(';')
}

// Convenience accessors for node views.
export function getLabel(key: string): ResolvedLabel | undefined {
  return state.byKey.get(key)
}

export function getCitation(key: string): ResolvedCitation | undefined {
  return state.citations.get(key)
}

export function getEquationNumbersForPos(pos: number): Array<string | null> | undefined {
  return state.equationNumbersByPos.get(pos)
}

export function getFloatNumberForPos(pos: number): FloatNumber | undefined {
  return state.floatNumbersByPos.get(pos)
}
