import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { foldable } from '@codemirror/language'
import { latexSupport } from '@renderer/editor/source/latex-language'
import {
  currentHeading,
  describeFold,
  headingLines,
  type Heading
} from '@renderer/editor/source/fold-commands'

// Collapsing a paper by outline level, and the breadcrumb that says which
// level you are standing in.

const PAPER = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  'Opening prose.',
  '\\subsection{Background}',
  'More prose.',
  '\\subsubsection{Detail}',
  'Fine print.',
  '\\section*{Discussion}',
  'Closing prose.',
  '\\end{document}'
].join('\n')

function state(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [latexSupport()] })
}

describe('headingLines', () => {
  it('finds every heading level, starred forms included', () => {
    expect(headingLines(state(PAPER))).toEqual([
      { line: 3, macro: 'section' },
      { line: 5, macro: 'subsection' },
      { line: 7, macro: 'subsubsection' },
      { line: 9, macro: 'section' }
    ])
  })

  it('ignores a heading macro that is not at the start of a line', () => {
    // `\section` inside prose or a comment is not a heading of the document.
    expect(headingLines(state('see \\section{Intro} above'))).toEqual([])
  })
})

describe('currentHeading', () => {
  const headings: Heading[] = [
    { line: 3, macro: 'section', title: 'Introduction' },
    { line: 5, macro: 'subsection', title: 'Background' },
    { line: 9, macro: 'section', title: 'Discussion' }
  ]

  it('is empty above the first heading', () => {
    expect(currentHeading(headings, 1)).toBe('')
  })

  it('names the heading the line sits under', () => {
    expect(currentHeading(headings, 4)).toBe('Introduction')
    expect(currentHeading(headings, 10)).toBe('Discussion')
  })

  it('prefers the innermost heading over the section containing it', () => {
    // Line 6 is inside \section{Introduction} but under \subsection{Background};
    // the breadcrumb answers "what am I writing", so the subsection wins.
    expect(currentHeading(headings, 6)).toBe('Background')
  })

  it('names the heading you are standing on', () => {
    expect(currentHeading(headings, 5)).toBe('Background')
  })
})

describe('latex folding ranges', () => {
  it('folds a section up to the next heading of the same rank', () => {
    const doc = state(PAPER)
    const line = doc.doc.line(3)
    const range = foldable(doc, line.from, line.to)
    expect(range).not.toBeNull()
    // Everything from the end of the heading up to the line before
    // \section*{Discussion}.
    expect(doc.doc.lineAt(range!.to).number).toBe(8)
  })

  it('folds a subsection without swallowing the next section', () => {
    const doc = state(PAPER)
    const line = doc.doc.line(5)
    const range = foldable(doc, line.from, line.to)
    expect(doc.doc.lineAt(range!.to).number).toBe(8)
  })

  it('folds an environment onto its \\begin line', () => {
    const doc = state('\\begin{proof}\nA line.\nAnother.\n\\end{proof}\nAfter.')
    const line = doc.doc.line(1)
    const range = foldable(doc, line.from, line.to)
    expect(range).not.toBeNull()
    expect(doc.doc.lineAt(range!.to).number).toBe(3)
  })

  it('does not offer a fold for an unclosed environment', () => {
    const doc = state('\\begin{proof}\nA line.\nNo closer.')
    const line = doc.doc.line(1)
    expect(foldable(doc, line.from, line.to)).toBeNull()
  })

  it('returns the same range when asked twice — the cache cannot go stale', () => {
    const doc = state(PAPER)
    const line = doc.doc.line(3)
    const first = foldable(doc, line.from, line.to)
    const second = foldable(doc, line.from, line.to)
    expect(second).toEqual(first)

    // An edited document is a new `Text`, so it computes afresh rather than
    // reusing an offset that no longer means anything.
    const edited = doc.update({ changes: { from: 0, insert: 'x\n' } }).state
    const moved = edited.doc.line(4)
    expect(foldable(edited, moved.from, moved.to)).not.toBeNull()
  })
})

describe('describeFold', () => {
  it('says how many lines went away', () => {
    const doc = state(PAPER)
    const from = doc.doc.line(3).to
    const to = doc.doc.line(8).to
    expect(describeFold(doc, { from, to })).toBe('⋯ 5 lines')
  })

  it('is singular for one line', () => {
    const doc = state(PAPER)
    expect(describeFold(doc, { from: doc.doc.line(3).to, to: doc.doc.line(4).to })).toBe('⋯ 1 line')
  })

  it('degrades to an ellipsis for a fold within one line', () => {
    const doc = state(PAPER)
    const line = doc.doc.line(3)
    expect(describeFold(doc, { from: line.from, to: line.to })).toBe('⋯')
  })
})
