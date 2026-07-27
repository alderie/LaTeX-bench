// What CodeMirror needs to know about LaTeX, beyond how to colour it.
//
// The source view used to be `StreamLanguage.define(stex)` and nothing else:
// a highlighter, a history, and a keymap. That is a text editor with LaTeX
// colours, and everything that makes editing a paper different from editing a
// text file was missing — you could not fold a proof away, `%` did not
// comment a line, `\begin{align}` did not close itself, a `\cite{` did not
// know which keys the document defines, and an `\end{aligned}` typed under a
// `\begin{align}` failed silently at compile time instead of loudly here.
//
// Everything in this module is one of those: language data, a fold service, a
// completion source, a linter. They are grouped here rather than inlined into
// the view so that the view stays a list of the features it turns on.

import { foldService, StreamLanguage, indentUnit } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { linter, type Diagnostic } from '@codemirror/lint'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import type { EditorState, Extension, Text } from '@codemirror/state'
import { catalogueEntries } from '../wysiwyg/math-complete'

/** Environments worth offering before the author has typed anything. */
const COMMON_ENVIRONMENTS = [
  'abstract',
  'align',
  'align*',
  'algorithm',
  'algorithmic',
  'bmatrix',
  'cases',
  'center',
  'corollary',
  'definition',
  'description',
  'enumerate',
  'equation',
  'equation*',
  'figure',
  'gather',
  'itemize',
  'lemma',
  'lstlisting',
  'pmatrix',
  'proof',
  'proposition',
  'quote',
  'remark',
  'table',
  'tabular',
  'theorem',
  'thebibliography',
  'verbatim'
]

/** Macros that take a document-defined key, and which registry to offer. */
const KEYED_MACROS: Record<string, 'label' | 'cite'> = {
  ref: 'label',
  eqref: 'label',
  cref: 'label',
  Cref: 'label',
  autoref: 'label',
  pageref: 'label',
  nameref: 'label',
  cite: 'cite',
  citep: 'cite',
  citet: 'cite',
  citeauthor: 'cite',
  citeyear: 'cite',
  parencite: 'cite',
  textcite: 'cite'
}

export const latexLanguage = StreamLanguage.define(stex)

/**
 * `%` is a line comment, which is what makes `Mod-/` work. The legacy stex
 * mode knows how to colour one but doesn't declare it, so the comment command
 * had nothing to toggle.
 */
export const latexLanguageData = latexLanguage.data.of({
  commentTokens: { line: '%' },
  closeBrackets: { brackets: ['(', '[', '{', '$'] },
  wordChars: '\\'
})

// ── Folding ────────────────────────────────────────────────────────────

const BEGIN_RE = /\\begin\{([^}]*)\}/
const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*\{/

/**
 * Fold an environment onto its `\begin` line, and a section onto its heading.
 *
 * The legacy stex mode produces a flat token stream with no block structure,
 * so there is nothing for the generic fold service to walk. Matching `\begin`
 * to `\end` by name and counting depth is both what a reader means by "fold
 * this proof away" and cheap enough to run per visible line.
 */
export const latexFolding = foldService.of((state, lineStart, lineEnd) => {
  // The fold gutter asks this for every visible line on every viewport
  // change, and an unmatched `\begin` makes each ask scan to the end of the
  // document. Cached per document version — `Text` is immutable, so an entry
  // can never be stale, and a document that has changed simply gets a fresh
  // (empty) map.
  let cache = foldCache.get(state.doc)
  if (!cache) foldCache.set(state.doc, (cache = new Map()))
  const cached = cache.get(lineStart)
  if (cached !== undefined) return cached
  const computed = computeFold(state, lineStart, lineEnd)
  cache.set(lineStart, computed)
  return computed
})

const foldCache = new WeakMap<Text, Map<number, { from: number; to: number } | null>>()

function computeFold(
  state: EditorState,
  lineStart: number,
  lineEnd: number
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart)
  const begin = BEGIN_RE.exec(line.text)
  if (begin) {
    const name = begin[1]
    let depth = 0
    for (let n = line.number; n <= state.doc.lines; n++) {
      const text = state.doc.line(n).text
      for (const match of text.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
        if (match[2] !== name) continue
        if (match[1] === 'begin') depth++
        else if (--depth === 0) {
          const end = state.doc.line(n)
          return end.from > lineEnd ? { from: lineEnd, to: end.from - 1 } : null
        }
      }
    }
    return null
  }

  const section = SECTION_RE.exec(line.text)
  if (!section) return null
  const rank = SECTION_RANK[section[1]]
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = SECTION_RE.exec(state.doc.line(n).text)
    if (!next || SECTION_RANK[next[1]] > rank) continue
    const stop = state.doc.line(n - 1)
    return stop.to > lineEnd ? { from: lineEnd, to: stop.to } : null
  }
  const last = state.doc.line(state.doc.lines)
  return last.to > lineEnd ? { from: lineEnd, to: last.to } : null
}

const SECTION_RANK: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4
}

// ── Completion ─────────────────────────────────────────────────────────

/**
 * What the document declares, computed once per document version.
 *
 * All three scans want the whole file as a string, and `doc.toString()` on a
 * long paper is not free. Keyed on the immutable `Text`, so the work happens
 * on the first completion after an edit and never again for that version.
 */
interface DocumentIndex {
  labels: string[]
  cites: string[]
  macros: string[]
  environments: string[]
}

const indexCache = new WeakMap<Text, DocumentIndex>()

function indexDocument(doc: Text): DocumentIndex {
  const cached = indexCache.get(doc)
  if (cached) return cached

  const text = doc.toString()
  const labels = new Set<string>()
  const cites = new Set<string>()
  const macros = new Set<string>()
  const environments = new Set<string>()

  for (const match of text.matchAll(/\\label\{([^}]+)\}/g)) labels.add(match[1].trim())
  for (const match of text.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    cites.add(match[1].trim())
  }
  for (const match of text.matchAll(
    /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z@]+)\}?/g
  )) {
    macros.add(`\\${match[1]}`)
  }
  for (const match of text.matchAll(/\\begin\{([^}]*)\}/g)) environments.add(match[1])

  const index: DocumentIndex = {
    labels: [...labels],
    cites: [...cites],
    macros: [...macros],
    environments: [...environments]
  }
  indexCache.set(doc, index)
  return index
}

const MACRO_COMPLETIONS: Completion[] = catalogueEntries().map((entry) => ({
  label: entry.name,
  type: 'function',
  detail: entry.detail,
  apply: (view, _completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: entry.insert },
      selection: { anchor: from + entry.caret }
    })
  }
}))

/**
 * Suggest what the document itself makes available.
 *
 * Three triggers, most specific first. Inside `\ref{` or `\cite{` the answer
 * is a key this file defines — the single most valuable completion in a
 * paper, because it is the one thing you otherwise scroll to look up. Inside
 * `\begin{` it is an environment name. After a bare `\` it is a macro, the
 * paper's own first.
 */
export function latexCompletions(context: CompletionContext): CompletionResult | null {
  // Nothing below this point reads the document unless a trigger matched,
  // and the read is cached per version when it does. This used to stringify
  // the whole paper on every keystroke, matched or not.
  const keyed = context.matchBefore(/\\([a-zA-Z]+)\s*(?:\[[^\]]*\])?\{([^}{]*)$/)
  if (keyed) {
    const macro = /\\([a-zA-Z]+)/.exec(keyed.text)?.[1] ?? ''
    const kind = KEYED_MACROS[macro]
    if (kind) {
      const typed = keyed.text.slice(keyed.text.lastIndexOf('{') + 1)
      const index = indexDocument(context.state.doc)
      return {
        from: keyed.to - typed.length,
        options: (kind === 'cite' ? index.cites : index.labels).map((key) => ({
          label: key,
          type: kind === 'cite' ? 'constant' : 'variable',
          detail: kind === 'cite' ? 'bibitem' : 'label'
        })),
        validFor: /^[^}]*$/
      }
    }
    if (macro === 'begin' || macro === 'end') {
      const typed = keyed.text.slice(keyed.text.lastIndexOf('{') + 1)
      const names = [
        ...new Set([...indexDocument(context.state.doc).environments, ...COMMON_ENVIRONMENTS])
      ]
      return {
        from: keyed.to - typed.length,
        options: names.map((name) => ({
          label: name,
          type: 'class',
          detail: 'environment'
        })),
        validFor: /^[^}]*$/
      }
    }
  }

  // A bare `\` lists everything, the paper's own macros first. At that point
  // the author has expressed no preference, and their notation is the
  // shortest thing to remind them of — the same rule the formula editor uses.
  const macro = context.matchBefore(/\\[a-zA-Z]*$/)
  if (!macro) return null
  const own: Completion[] = indexDocument(context.state.doc).macros.map((name) => ({
    label: name,
    type: 'function',
    detail: 'from this paper',
    boost: 1
  }))
  return {
    from: macro.from,
    options: [...own, ...MACRO_COMPLETIONS],
    validFor: /^\\[a-zA-Z]*$/
  }
}

// ── Linting ────────────────────────────────────────────────────────────

/**
 * The two errors that cost the most time.
 *
 * A mismatched `\begin`/`\end` and an odd number of `$` are both silent here
 * and catastrophic at compile time: pdflatex reports them at the point it
 * gives up, which is routinely hundreds of lines below the line that is
 * actually wrong. Flagging them where they happen is the whole value.
 *
 * Deliberately nothing else. A linter that also has opinions about spacing
 * would put a squiggle under half of every paper.
 */
export function latexDiagnostics(state: EditorState): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const text = state.doc.toString()
  const stack: Array<{ name: string; from: number; to: number }> = []

  for (const match of text.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    const from = match.index
    const to = from + match[0].length
    if (match[1] === 'begin') {
      stack.push({ name: match[2], from, to })
      continue
    }
    const open = stack.pop()
    if (!open) {
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: `\\end{${match[2]}} with no matching \\begin`
      })
      continue
    }
    if (open.name !== match[2]) {
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: `\\end{${match[2]}} closes \\begin{${open.name}}`
      })
    }
  }
  for (const open of stack) {
    diagnostics.push({
      from: open.from,
      to: open.to,
      severity: 'error',
      message: `\\begin{${open.name}} is never closed`
    })
  }

  // `$` counted per line: a display spanning lines uses `\[…\]` or an
  // environment, so an unmatched `$` is nearly always a typo on one line —
  // and counting across the file would blame the wrong one.
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const stripped = line.text.replace(/\\[$%&#_{}]/g, '  ').replace(/%.*$/, '')
    const dollars = (stripped.match(/\$\$|\$/g) ?? []).filter((d) => d === '$').length
    if (dollars % 2 === 1) {
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: 'warning',
        message: 'Odd number of $ on this line — an unclosed inline formula?'
      })
    }
  }
  return diagnostics
}

// Runs on a trailing delay: a squiggle that appears while you are still
// typing the `\end` is a squiggle that is wrong more often than it is right.
export const latexLinter = linter((view) => latexDiagnostics(view.state), {
  delay: 600
})

// ── Typing helpers ─────────────────────────────────────────────────────

/**
 * Close an environment as it is opened.
 *
 * Typing the `}` of `\begin{align}` writes `\end{align}` two lines down and
 * leaves the caret between them, which is the whole of what an author wanted
 * when they typed it. Skipped when the environment already has a matching
 * `\end` below — pasting a block, or editing the name of an existing one,
 * must not produce a second closer.
 */
export const closeEnvironments = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '}') return false
  const line = view.state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from) + '}'
  const match = /\\begin\{([a-zA-Z@]+\*?)\}$/.exec(before)
  if (!match) return false

  const name = match[1]
  const rest = view.state.doc.sliceString(to, view.state.doc.length)
  if (new RegExp(`\\\\end\\{${escapeRegExp(name)}\\}`).test(rest)) return false

  const indent = /^\s*/.exec(line.text)?.[0] ?? ''
  const insert = `}\n${indent}  \n${indent}\\end{${name}}`
  view.dispatch({
    changes: { from, to, insert },
    // Between the two, on the indented blank line.
    selection: { anchor: from + 2 + indent.length + 2 },
    userEvent: 'input.type'
  })
  return true
})

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Everything above, as one extension. */
export function latexSupport(): Extension {
  return [
    latexLanguage,
    latexLanguageData,
    indentUnit.of('  '),
    latexFolding,
    latexLinter,
    closeEnvironments
  ]
}
