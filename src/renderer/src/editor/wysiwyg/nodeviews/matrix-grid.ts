// Editing a matrix as a matrix.
//
// The body of a `pmatrix` is `a & b \\ c & d`, and editing that in a text area
// means the author maintains the ampersands and the row breaks by hand: adding
// a column is four separate insertions in four different places, all of which
// have to agree or KaTeX reports a column-count error somewhere else entirely.
//
// So when the whole body *is* a grid, it is drawn as one: a cell is an input,
// you click the value you want to change, and Tab walks the grid. Growing it
// is the part worth getting right — a dashed placeholder sits above, below and
// to either side of the real cells, and typing into one turns it into a real
// row or column. That means "make this 3×3" is done by typing where the third
// row should be, rather than by hunting for an "add row" button and then
// finding out which end it added to.
//
// The cells are the model. Everything round-trips through `toCells`/`fromCells`
// in math-source, so the grid can't emit a ragged body.

import { fromCells, toCells } from '../math-source'

export interface MatrixGridOptions {
  /** The grid body, e.g. `a & b \\ c & d`. */
  body: string
  /** Called with the rewritten body whenever a cell or the shape changes. */
  onChange: (body: string) => void
}

export class MatrixGrid {
  readonly dom: HTMLElement
  private cells: string[][]
  /** Where to put the caret after the next render, in real-cell coords. */
  private focusAt: { row: number; column: number } | null = null

  constructor(private options: MatrixGridOptions) {
    this.cells = toCells(options.body)
    this.dom = document.createElement('div')
    this.dom.className = 'matrix-grid'
    this.render()
  }

  /** Adopt a body edited elsewhere (the LaTeX view, an environment switch). */
  setBody(body: string): void {
    this.cells = toCells(body)
    this.render()
  }

  focus(): void {
    this.cellInput(0, 0)?.focus()
  }

  destroy(): void {
    this.dom.remove()
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private get rows(): number {
    return this.cells.length
  }

  private get columns(): number {
    return this.cells[0]?.length ?? 1
  }

  private cellInput(row: number, column: number): HTMLInputElement | null {
    return this.dom.querySelector(`input[data-row="${row}"][data-column="${column}"]`)
  }

  /**
   * The grid is drawn one track wider than the matrix on every side. The extra
   * tracks hold the dashed placeholders; the four corners where two
   * placeholders would cross are left empty, because "add a row and a column at
   * once" isn't a thing anyone means.
   */
  private render(): void {
    this.dom.replaceChildren()
    this.dom.style.gridTemplateColumns = `repeat(${this.columns + 2}, auto)`

    for (let r = -1; r <= this.rows; r++) {
      for (let c = -1; c <= this.columns; c++) {
        const ghostRow = r === -1 || r === this.rows
        const ghostColumn = c === -1 || c === this.columns
        if (ghostRow && ghostColumn) {
          const corner = document.createElement('span')
          corner.className = 'matrix-grid__corner'
          this.dom.appendChild(corner)
          continue
        }
        this.dom.appendChild(
          ghostRow || ghostColumn ? this.buildGhost(r, c) : this.buildCell(r, c)
        )
      }
    }

    if (this.focusAt) {
      const { row, column } = this.focusAt
      this.focusAt = null
      const input = this.cellInput(row, column)
      if (input) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    }
  }

  private buildCell(row: number, column: number): HTMLElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'matrix-grid__cell'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.value = this.cells[row][column]
    input.dataset.row = String(row)
    input.dataset.column = String(column)
    input.size = 1
    sizeToContent(input)

    input.addEventListener('input', () => {
      this.cells[row][column] = input.value
      sizeToContent(input)
      this.emit()
    })
    input.addEventListener('keydown', (event) => this.onCellKey(event, row, column))
    return input
  }

  /**
   * A placeholder for a row or column that doesn't exist yet. It looks like an
   * empty cell and behaves like one: type in it and it becomes real, with the
   * caret still in it and the character already typed.
   */
  private buildGhost(row: number, column: number): HTMLElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'matrix-grid__cell matrix-grid__cell--ghost'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.size = 1
    const grows = row === -1 ? 'row above' : row === this.rows ? 'row below' : column === -1 ? 'column before' : 'column after'
    input.title = `Type here to add a ${grows}`
    input.setAttribute('aria-label', `Add a ${grows}`)

    input.addEventListener('input', () => {
      const typed = input.value
      // Materialise, then re-render: the ghost element itself is discarded, so
      // the caret is restored by coordinates rather than by holding the node.
      if (row === -1) {
        this.cells.unshift(blankRow(this.columns))
        this.cells[0][Math.max(0, column)] = typed
        this.focusAt = { row: 0, column: Math.max(0, column) }
      } else if (row === this.rows) {
        this.cells.push(blankRow(this.columns))
        this.cells[this.rows - 1][Math.max(0, column)] = typed
        this.focusAt = { row: this.rows - 1, column: Math.max(0, column) }
      } else if (column === -1) {
        for (const line of this.cells) line.unshift('')
        this.cells[row][0] = typed
        this.focusAt = { row, column: 0 }
      } else {
        for (const line of this.cells) line.push('')
        this.cells[row][this.columns - 1] = typed
        this.focusAt = { row, column: this.columns - 1 }
      }
      this.render()
      this.emit()
    })
    return input
  }

  // ── Navigation ───────────────────────────────────────────────────────

  private onCellKey(event: KeyboardEvent, row: number, column: number): void {
    const input = event.target as HTMLInputElement
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0
    const atEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length

    switch (event.key) {
      case 'Tab':
        event.preventDefault()
        this.step(row, column, event.shiftKey ? -1 : 1)
        return
      case 'ArrowRight':
        if (!atEnd) return
        event.preventDefault()
        this.go(row, column + 1)
        return
      case 'ArrowLeft':
        if (!atStart) return
        event.preventDefault()
        this.go(row, column - 1)
        return
      case 'ArrowDown':
        event.preventDefault()
        this.go(row + 1, column)
        return
      case 'ArrowUp':
        event.preventDefault()
        this.go(row - 1, column)
        return
      case 'Enter':
        // Enter at the last row adds one, matching what Tab does at the last
        // cell. Anywhere else it just drops to the row below.
        if (event.metaKey || event.ctrlKey) return // the editor's "done"
        event.preventDefault()
        if (row === this.rows - 1) {
          this.cells.push(blankRow(this.columns))
          this.focusAt = { row: this.rows - 1, column }
          this.render()
          this.emit()
        } else {
          this.go(row + 1, column)
        }
        return
      case 'Backspace':
        // Emptying the last cell of an all-empty row removes the row, so a
        // grid grown by accident can be shrunk the same way.
        if (input.value !== '' || this.rows <= 1) return
        if (!this.cells[row].every((cell) => cell === '')) return
        event.preventDefault()
        this.cells.splice(row, 1)
        this.focusAt = { row: Math.max(0, row - 1), column }
        this.render()
        this.emit()
        return
    }
  }

  /** Move one cell in reading order, growing the grid at the far corner. */
  private step(row: number, column: number, direction: 1 | -1): void {
    let nextColumn = column + direction
    let nextRow = row
    if (nextColumn >= this.columns) {
      nextColumn = 0
      nextRow++
    } else if (nextColumn < 0) {
      nextColumn = this.columns - 1
      nextRow--
    }
    if (nextRow >= this.rows) {
      this.cells.push(blankRow(this.columns))
      this.focusAt = { row: this.rows - 1, column: 0 }
      this.render()
      this.emit()
      return
    }
    if (nextRow < 0) return
    this.go(nextRow, nextColumn)
  }

  private go(row: number, column: number): void {
    const input = this.cellInput(
      Math.min(Math.max(row, 0), this.rows - 1),
      Math.min(Math.max(column, 0), this.columns - 1)
    )
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  private emit(): void {
    this.options.onChange(fromCells(this.cells))
  }
}

function blankRow(width: number): string[] {
  return Array.from({ length: width }, () => '')
}

/** Grow a cell to fit what's in it, with a floor so empty cells stay clickable. */
function sizeToContent(input: HTMLInputElement): void {
  input.size = Math.max(2, input.value.length + 1)
}
