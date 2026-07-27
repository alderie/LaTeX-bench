import { foldEffect, foldable, foldedRanges, unfoldAll } from '@codemirror/language'
import type { EditorState, StateEffect } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

// Collapsing a paper by outline level.
//
// `latexFolding` (in latex-language.ts) already knows how to fold one
// section or one environment onto its opening line. What was missing is the
// move you actually make on a long paper: collapse the whole thing to its
// section headings so you can see the shape of it, then open the one you
// want. That is VS Code's "Fold Level N", and on a LaTeX file the levels are
// already named — \section, \subsection, \subsubsection.

const HEADING_RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*\{/

/** Which heading macro each outline level collapses. */
const LEVEL_MACROS: Record<number, string[]> = {
  1: ['part', 'chapter', 'section'],
  2: ['subsection'],
  3: ['subsubsection']
}

export interface Heading {
  /** 1-based source line the heading macro is on. */
  line: number
  /** `section`, `subsection`, … */
  macro: string
  /** The heading's text, when the caller has filled it in. */
  title?: string
}

/** Every heading line in the document, in source order. */
export function headingLines(state: EditorState): Heading[] {
  const out: Heading[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const match = HEADING_RE.exec(state.doc.line(n).text)
    if (match) out.push({ line: n, macro: match[1] })
  }
  return out
}

/**
 * Collapse every section at one outline level, leaving the levels above it
 * open.
 *
 * Unfolds first, so the levels are a state you land in rather than a set of
 * folds that accumulate: pressing level 2 after level 1 shows sections with
 * their subsections collapsed, not the level-1 result with more folded under
 * it.
 */
export function foldToLevel(level: number): Command {
  const macros = LEVEL_MACROS[level] ?? []
  return (view: EditorView): boolean => {
    if (!macros.length) return false
    unfoldAll(view)

    const effects: StateEffect<unknown>[] = []
    for (const heading of headingLines(view.state)) {
      if (!macros.includes(heading.macro)) continue
      const line = view.state.doc.line(heading.line)
      const range = foldable(view.state, line.from, line.to)
      if (range) effects.push(foldEffect.of(range))
    }
    if (!effects.length) return false
    view.dispatch({ effects })
    return true
  }
}

/** How many ranges are folded right now — the status line reports it. */
export function countFolded(state: EditorState): number {
  let count = 0
  foldedRanges(state).between(0, state.doc.length, () => {
    count++
  })
  return count
}

/**
 * The chevron in the fold gutter.
 *
 * The default is a text arrow that inherits the gutter's colour, which on a
 * line-numbered gutter reads as another number. This is a proper triangle
 * that dims until the pointer is over the gutter — present when you look for
 * it, invisible when you're reading.
 */
export function foldMarkerDOM(open: boolean): HTMLElement {
  const span = document.createElement('span')
  span.className = `cm-foldMarker${open ? '' : ' cm-foldMarker--closed'}`
  span.setAttribute('aria-label', open ? 'Collapse' : 'Expand')
  span.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
    '<path d="M2.5 3.5 L5 6.5 L7.5 3.5" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  return span
}

/** What a folded range is described as, given the range being folded. */
export function describeFold(state: EditorState, range: { from: number; to: number }): string {
  const lines = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number
  if (lines <= 0) return '⋯'
  return `⋯ ${lines} line${lines === 1 ? '' : 's'}`
}

/** The widget shown in place of folded text. */
export function foldPlaceholderDOM(
  _view: EditorView,
  onclick: (event: Event) => void,
  prepared: string | null
): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cm-foldPlaceholder'
  span.textContent = prepared ?? '⋯'
  span.title = 'Click to expand'
  span.setAttribute('role', 'button')
  span.onclick = onclick
  return span
}

/**
 * The innermost heading above a line — the status line's breadcrumb.
 *
 * "Above" by source position rather than by level: a subsection heading wins
 * over the section it is inside, because the question the breadcrumb answers
 * is "what am I writing right now", not "what part of the paper is this".
 */
export function currentHeading(headings: Heading[], line: number): string {
  let best: Heading | null = null
  for (const heading of headings) {
    if (heading.line > line) break
    best = heading
  }
  return best?.title ?? ''
}
