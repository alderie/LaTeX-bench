// Finding the cells in a rendered formula.
//
// The formula editor used to offer two ways to look at a matrix: the LaTeX,
// and a separate grid of text inputs you had to switch to. The second one
// only ever appeared when the *whole* body was a single matrix, which ruled
// out the common case —
//
//     H = \begin{pmatrix}2 & 1 \\ 1 & 2\end{pmatrix}, \qquad H^{-1} = \frac{1}{3}\begin{pmatrix}…
//
// — two matrices with maths between them, where nothing could be clicked. And
// where it did appear it was a third rendering of the same formula: not the
// LaTeX, not the typeset result, but a table of monospace boxes.
//
// The typeset result is already on screen, underneath the source, and it is
// already laid out as a grid. So rather than drawing a grid beside it, this
// finds the cells *in* it and says which characters of the body each one came
// from. Clicking one is then an edit to a span of the source, and the thing
// you click is the thing you were reading.
//
// The trace is positional. KaTeX draws every grid as `.mtable`, column by
// column, each column a vertical list with one entry per row that has a cell
// there; `gridSpans` lists the same grids in the same order. So the nth table
// belongs to the nth grid, and within it the nth entry of column c belongs to
// the nth source cell in column c. Nothing is guessed from the rendered text.
//
// Because it is positional it is also all-or-nothing: if the number of tables
// and the number of grids disagree — a preamble macro that expands to a
// matrix, an environment KaTeX draws as a table and this module has never
// heard of — then some table's source is unknown, and every table after it
// would be attributed to the wrong one. In that case nothing is marked and
// the source area remains the way to edit the formula.

import { gridCells, gridSpans, type GridCell, type MathShell } from '../math-source'
import { markCell, type CellSite } from '../editors/cell-editor'

/**
 * Mark the cells of every grid in a KaTeX rendering of `body`.
 *
 * Returns them in reading order — the order Tab should walk — which is not
 * the order they appear in the DOM: KaTeX emits a table column by column.
 */
export function markMathCells(host: HTMLElement, shell: MathShell, body: string): CellSite[] {
  const spans = gridSpans(shell, body)
  const tables = host.querySelectorAll<HTMLElement>('.mtable')
  if (spans.length === 0 || tables.length !== spans.length) return []

  const found: Array<{ el: HTMLElement; cell: GridCell; grid: number }> = []
  for (let index = 0; index < spans.length; index++) {
    const cells = gridCells(body, spans[index])
    const columns = renderedColumns(tables[index])
    if (!agrees(cells, columns)) return []

    const depths = new Map<number, number>()
    for (const cell of cells) {
      const depth = depths.get(cell.column) ?? 0
      depths.set(cell.column, depth + 1)
      found.push({ el: columns[cell.column][depth], cell, grid: index })
    }
  }

  return found.map(({ el, cell, grid }) =>
    markCell(el, {
      grid,
      row: cell.row,
      column: cell.column,
      from: cell.from,
      to: cell.to
    })
  )
}

/**
 * One rendered table as columns of cell elements.
 *
 * A column is a `.vlist` of absolutely positioned rows; each row holds a
 * `.pstrut` that reserves its height and then the cell itself. The strut is
 * how a row is told from the second, empty `.vlist-r` KaTeX appends to carry
 * the table's depth.
 */
function renderedColumns(table: HTMLElement): HTMLElement[][] {
  const columns: HTMLElement[][] = []
  for (const child of Array.from(table.children)) {
    if (!/(^|\s)col-align-/.test(child.className)) continue
    // `querySelector` from the column, not the table: a nested matrix has
    // vertical lists of its own, and they are descendants of a cell in here.
    // The column's own list is an ancestor of those, so it comes first.
    const vlist = child.querySelector('.vlist-r > .vlist')
    const rows: HTMLElement[] = []
    for (const row of Array.from(vlist?.children ?? [])) {
      const struts = Array.from(row.children).filter((el) => el.classList.contains('pstrut'))
      if (struts.length === 0) continue
      const content = row.lastElementChild
      rows.push((content && !content.classList.contains('pstrut') ? content : row) as HTMLElement)
    }
    columns.push(rows)
  }
  return columns
}

/** Whether what was drawn has the same shape as what the source says. */
function agrees(cells: GridCell[], columns: HTMLElement[][]): boolean {
  const heights: number[] = []
  for (const cell of cells) heights[cell.column] = (heights[cell.column] ?? 0) + 1
  if (heights.length !== columns.length) return false
  return heights.every((height, column) => height === columns[column].length)
}
