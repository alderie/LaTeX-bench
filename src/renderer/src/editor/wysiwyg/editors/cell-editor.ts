// Editing a cell where it is drawn.
//
// Two surfaces in this editor render a grid of LaTeX: the formula panel's
// typeset preview, and the table panel's rendered table. Both used to be
// read-only pictures of the source above them — to change the `4.81` you
// could see, you found the `4.81` you couldn't, somewhere in a line of `&`s.
//
// This makes the picture the editing surface. It knows nothing about maths or
// about tables; what it takes is elements that carry the offsets of the text
// they were drawn from, and what it does is float a small LaTeX field over the
// one you clicked. Everything else — how those offsets were arrived at, what
// re-rendering means — is the caller's, which is why the same class serves a
// KaTeX matrix and an HTML table.
//
// The edit is written through on every keystroke rather than on commit. That
// keeps the source area above in step as you type, and it means the usual
// ways of finishing a block (⌘⏎, clicking away) need no special case here:
// whatever is in the field is already in the source.

import { CodeField } from './code-field'

export interface CellSite {
  el: HTMLElement
  /** Offsets of the cell's text in whatever source the caller holds. */
  from: number
  to: number
  /** Which grid in the surface, for surfaces that can hold more than one. */
  grid: number
  row: number
  column: number
}

/** What marks an element as a cell, for event delegation and for tests. */
export const CELL_ATTRIBUTE = 'data-cell-from'

/**
 * Tag a rendered element with the span of source it came from.
 *
 * The renderers call this — a KaTeX matrix entry and a table's `<td>` are the
 * same thing as far as editing goes — and hand the result to a `CellEditor`.
 */
export function markCell(
  el: HTMLElement,
  cell: { grid: number; row: number; column: number; from: number; to: number }
): CellSite {
  el.classList.add('source-cell')
  // An empty cell can render to nothing at all, which is nothing to click.
  el.classList.toggle('source-cell--empty', cell.from === cell.to)
  el.setAttribute(CELL_ATTRIBUTE, String(cell.from))
  el.dataset.cellTo = String(cell.to)
  el.dataset.cellGrid = String(cell.grid)
  el.dataset.cellRow = String(cell.row)
  el.dataset.cellColumn = String(cell.column)
  return { el, ...cell }
}

export interface CellEditorOptions {
  /** The rendered surface. Positioned, so the field can sit over a cell. */
  host: HTMLElement
  /** The cell's current text, for seeding the field. */
  read: (cell: CellSite) => string
  /** Replace the cell's span with `text`; returns the span's new end. */
  write: (cell: CellSite, text: string) => number
  /** Re-render the surface and hand back the cells it now exposes. */
  repaint: () => CellSite[]
  /**
   * Add a row or a column to the cell's grid, so Tab at the last cell and
   * Enter at the last row grow the grid rather than stopping dead — which is
   * what every table editor does, and what people file bugs about when it
   * doesn't happen.
   */
  grow?: (cell: CellSite, what: 'row' | 'column') => void
  /** Editing ended without moving on: put the caret back where it belongs. */
  onDone?: () => void
  /** ⌘⏎ finishes the whole block, not just the cell. */
  onCommitBlock?: () => void
}

export class CellEditor {
  private field: CodeField | null = null
  private cell: CellSite | null = null
  private original = ''
  private cells: CellSite[] = []

  constructor(private options: CellEditorOptions) {
    // mousedown, not click: the press is what blurs the source field, and the
    // surrounding editor reads a blur as "the author moved on" and commits.
    // Cancelling it keeps focus put until the cell's own field takes it.
    options.host.addEventListener('mousedown', (event) => this.onPointerDown(event))
  }

  /** Whether a cell is being edited, so the caller can hold off repainting. */
  get active(): boolean {
    return this.cell !== null
  }

  /** Adopt the cells a fresh render exposes. */
  setCells(cells: CellSite[]): void {
    this.cells = cells
  }

  /** Open a cell by its coordinates, after a repaint replaced the elements. */
  openAt(grid: number, row: number, column: number): boolean {
    const target = this.cells.find(
      (cell) => cell.grid === grid && cell.row === row && cell.column === column
    )
    if (!target) return false
    this.open(target)
    return true
  }

  close(): void {
    if (!this.cell) return
    this.cell.el.classList.remove('source-cell--editing')
    this.cell = null
    this.field?.dom.remove()
    this.field = null
  }

  destroy(): void {
    this.close()
  }

  // ── Opening ──────────────────────────────────────────────────────────

  private onPointerDown(event: MouseEvent): void {
    // A press inside the open field is the author placing a caret in it. It
    // sits over the cell it is editing, so without this the cell underneath
    // would take the press and reopen — losing the click.
    if (this.field?.dom.contains(event.target as Node)) return

    const el = (event.target as HTMLElement | null)?.closest(`[${CELL_ATTRIBUTE}]`)
    const cell =
      (el instanceof HTMLElement ? this.cells.find((c) => c.el === el) : undefined) ??
      this.cellUnder(event)
    if (!cell) {
      // A press on the surface but between its cells. While a cell is open
      // that press would blur the field, which the block around it reads as
      // "the author moved on" and closes on — so it is swallowed instead.
      if (this.active) event.preventDefault()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!this.active) {
      this.open(cell)
      return
    }
    // Straight from one cell to another: the surface has to be redrawn for
    // the cell being left, which replaces the element that was clicked — so
    // the new cell is reopened by its coordinates rather than by its node.
    const { grid, row, column } = cell
    this.finish(false)
    this.openAt(grid, row, column)
  }

  /**
   * The cell a press landed inside, by geometry.
   *
   * A fallback for when the event's target isn't the cell it visually hit.
   * KaTeX builds a matrix out of overlapping absolutely positioned rows, and
   * which element a browser hands back for a point in there is not something
   * worth depending on.
   */
  private cellUnder(event: MouseEvent): CellSite | undefined {
    let best: CellSite | undefined
    let smallest = Infinity
    for (const cell of this.cells) {
      const box = cell.el.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right) continue
      if (event.clientY < box.top || event.clientY > box.bottom) continue
      const area = box.width * box.height
      if (area >= smallest) continue
      smallest = area
      best = cell
    }
    return best
  }

  private open(cell: CellSite): void {
    this.close()
    this.cell = cell
    this.original = this.options.read(cell)
    cell.el.classList.add('source-cell--editing')

    const field = new CodeField({
      value: this.original,
      multiline: false,
      className: 'code-field--cell',
      onInput: () => this.onInput()
    })
    this.field = field
    field.dom.classList.add('cell-editor')
    this.options.host.appendChild(field.dom)
    this.place()

    field.input.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    // Leaving for anywhere that isn't another cell of this surface ends the
    // edit. The text is already written, so there is nothing to commit.
    field.input.addEventListener('blur', () => {
      if (this.field === field) this.finish(false)
    })
    field.focus()
    // The whole value selected: a cell is usually replaced rather than
    // amended, and a caret can still be placed by clicking in the field.
    field.setSelectionRange(0, this.original.length)
  }

  /**
   * Sit the field over the cell it is editing.
   *
   * Centred on it rather than aligned to its corner: a matrix entry is one
   * or two glyphs and the field is wider than that whatever it holds, so
   * anchoring left would push it into the next column while leaving the cell
   * it belongs to at its edge.
   */
  private place(): void {
    const field = this.field
    const cell = this.cell
    if (!field || !cell) return
    const host = this.options.host
    const frame = host.getBoundingClientRect()
    const box = cell.el.getBoundingClientRect()
    field.dom.style.minWidth = `${Math.max(box.width + 10, 42)}px`

    // Measured after the width is set, since that is what the field's own
    // size is derived from.
    const width = field.dom.offsetWidth
    const height = field.dom.offsetHeight
    const left = box.left - frame.left + host.scrollLeft + (box.width - width) / 2
    const top = box.top - frame.top + host.scrollTop + (box.height - height) / 2
    field.dom.style.left = `${Math.max(0, Math.min(left, host.clientWidth - width))}px`
    field.dom.style.top = `${Math.max(0, top)}px`
  }

  // ── Editing ──────────────────────────────────────────────────────────

  private onInput(): void {
    const cell = this.cell
    if (!cell || !this.field) return
    // The span moves as the text grows, and the next keystroke has to write
    // over what this one wrote rather than beside it.
    cell.to = this.options.write(cell, this.field.value)
  }

  private onKeyDown(event: KeyboardEvent): void {
    const cell = this.cell
    if (!cell) return

    // The block's own finish key. Told to the caller rather than left to
    // bubble: closing the field detaches it, and an event whose target is no
    // longer in the document reaches nobody.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      this.options.onCommitBlock?.()
      return
    }

    switch (event.key) {
      case 'Escape': {
        event.preventDefault()
        // The formula, not just this cell, is what Escape would otherwise
        // throw away — and the author is undoing one number.
        event.stopPropagation()
        this.revert()
        return
      }
      case 'Tab': {
        event.preventDefault()
        event.stopPropagation()
        this.step(event.shiftKey ? -1 : 1)
        return
      }
      case 'Enter': {
        event.preventDefault()
        event.stopPropagation()
        this.down()
        return
      }
    }
  }

  /** Move one cell in reading order, growing the grid at the far corner. */
  private step(direction: 1 | -1): void {
    const cell = this.cell
    if (!cell) return
    const order = this.cells.filter((candidate) => candidate.grid === cell.grid)
    const index = order.findIndex(
      (candidate) => candidate.row === cell.row && candidate.column === cell.column
    )
    const next = order[index + direction]
    if (next) {
      this.moveTo(next.grid, next.row, next.column)
      return
    }
    if (direction === -1) {
      this.finish(true)
      return
    }
    this.growInto('column', cell.grid, cell.row, cell.column + 1)
  }

  /** Enter goes down a row, and makes one at the bottom of the grid. */
  private down(): void {
    const cell = this.cell
    if (!cell) return
    const below = this.cells.find(
      (candidate) =>
        candidate.grid === cell.grid &&
        candidate.row === cell.row + 1 &&
        candidate.column === cell.column
    )
    if (below) {
      this.moveTo(below.grid, below.row, below.column)
      return
    }
    this.growInto('row', cell.grid, cell.row + 1, cell.column)
  }

  private growInto(what: 'row' | 'column', grid: number, row: number, column: number): void {
    const cell = this.cell
    if (!cell || !this.options.grow) {
      this.finish(true)
      return
    }
    this.options.grow(cell, what)
    this.close()
    this.setCells(this.options.repaint())
    if (!this.openAt(grid, row, column)) this.options.onDone?.()
  }

  /** Commit what is written and open another cell in its place. */
  private moveTo(grid: number, row: number, column: number): void {
    this.close()
    this.setCells(this.options.repaint())
    if (!this.openAt(grid, row, column)) this.options.onDone?.()
  }

  private revert(): void {
    const cell = this.cell
    if (!cell) return
    cell.to = this.options.write(cell, this.original)
    this.finish(true)
  }

  /** End the edit, redraw what it changed, and hand focus back. */
  private finish(refocus: boolean): void {
    if (!this.cell) return
    this.close()
    this.setCells(this.options.repaint())
    if (refocus) this.options.onDone?.()
  }
}
