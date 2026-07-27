import { describe, it, expect } from 'vitest'
import katex from 'katex'
import { markMathCells } from '@renderer/editor/wysiwyg/renderers/math-cells'
import { parseMathShell } from '@renderer/editor/wysiwyg/math-source'

// Tracing a rendered cell back to the characters it came from. This is what
// makes the typeset formula in the editor an editing surface rather than a
// picture of one, so what it must never do is map a cell onto the wrong
// source — the tests below are mostly about the cases where it declines.

interface Marked {
  text: string
  drawn: string
  grid: number
  row: number
  column: number
}

function mark(
  body: string,
  options: { wrapper?: string; macros?: Record<string, string> } = {}
): Marked[] {
  const source = options.wrapper
    ? `\\begin{${options.wrapper}}\n${body}\n\\end{${options.wrapper}}`
    : `\\[\n${body}\n\\]`
  const shell = parseMathShell(source)
  const host = document.createElement('div')
  katex.render(options.wrapper ? `\\begin{${options.wrapper}*}${body}\\end{${options.wrapper}*}` : body, host, {
    displayMode: true,
    throwOnError: false,
    strict: false,
    macros: options.macros
  })
  return markMathCells(host, shell, body).map((cell) => ({
    text: body.slice(cell.from, cell.to),
    drawn: cell.el.textContent ?? '',
    grid: cell.grid,
    row: cell.row,
    column: cell.column
  }))
}

describe('cells in a rendered formula', () => {
  it('marks every entry of a matrix, in reading order', () => {
    const cells = mark('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
    expect(cells.map((cell) => cell.text)).toEqual(['a', 'b', 'c', 'd'])
    expect(cells.map((cell) => [cell.row, cell.column])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1]
    ])
  })

  it('marks the element that was drawn from the source it names', () => {
    // The whole point: what is clicked and what is edited have to be the
    // same cell. KaTeX emits a table column by column, so an ordering slip
    // here would silently transpose a matrix as it was edited.
    for (const cell of mark('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')) {
      expect(cell.drawn).toBe(cell.text)
    }
  })

  it('handles a formula that holds more than one matrix', () => {
    // The case the old cells view refused outright.
    const cells = mark(
      'H = \\begin{pmatrix} a & b \\end{pmatrix} + \\begin{pmatrix} c \\end{pmatrix}'
    )
    expect(cells.map((cell) => [cell.grid, cell.text])).toEqual([
      [0, 'a'],
      [0, 'b'],
      [1, 'c']
    ])
  })

  it('marks the rows of an align, whose grid is the body itself', () => {
    const cells = mark('a &= b \\\\ c &= d', { wrapper: 'align' })
    expect(cells.map((cell) => cell.text)).toEqual(['a', '= b', 'c', '= d'])
  })

  it('marks a matrix nested inside another grid', () => {
    const cells = mark('x &= \\begin{pmatrix} p \\\\ q \\end{pmatrix}', { wrapper: 'align' })
    expect(cells.filter((cell) => cell.grid === 1).map((cell) => cell.text)).toEqual(['p', 'q'])
  })

  it('marks nothing when a grid was drawn that the source cannot account for', () => {
    // A preamble macro that expands to a matrix draws a table with no
    // `\begin` behind it. Mapping the tables that follow it by position
    // would attribute each one to the wrong source, so nothing is offered:
    // the formula is still editable as LaTeX.
    const cells = mark('\\M + \\begin{pmatrix} a \\end{pmatrix}', {
      macros: { '\\M': '\\begin{pmatrix}1\\end{pmatrix}' }
    })
    expect(cells).toEqual([])
  })

  it('agrees with KaTeX about what a row break is', () => {
    // `\\` inside a `\text` is punctuation, not structure. Reading it as a
    // row break would make the source claim two rows where one was drawn,
    // and every cell after it would be off by one.
    const cells = mark('\\begin{pmatrix} \\text{a \\\\ b} & c \\end{pmatrix}')
    expect(cells.map((cell) => cell.text)).toEqual(['\\text{a \\\\ b}', 'c'])
  })

  it('has nothing to offer for a formula with no grid in it', () => {
    expect(mark('x^2 + y^2')).toEqual([])
  })
})
