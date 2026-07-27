// The table's shape, as a control rather than a caption.
//
// The bar has always said `5 × 4` beside a table — a measurement the author
// didn't ask for but wants while they're here. It was only ever a label, so
// the way to make a 5×4 table out of a 2×2 one was to add a row, add a row,
// add a row, add a column, add a column — five separate actions to say one
// number, and that was when the bar still had buttons for it.
//
// So the measurement is the control: double-click it and the two numbers
// become fields. What they set is the shape; the rows and columns that appear
// are empty, and get filled the way every other cell does — in the rendering
// underneath, or in the source above.
//
// Double-click rather than click, because the thing is a caption first: it is
// read far more often than it is set, and a caption that opens fields when
// the pointer brushes it reads as a trap.

export interface ShapeFieldOptions {
  /** Tooltip, since a caption that can be edited has to say so somewhere. */
  title?: string
  /** The shape the author typed, on Enter or on leaving the fields. */
  onCommit: (rows: number, columns: number) => void
  /** Editing ended; hand focus back to wherever it belongs. */
  onDone?: () => void
}

export interface ShapeField {
  readonly dom: HTMLElement
  /** Reflect a shape the table now has — after an edit, an undo, a resize. */
  setValue: (rows: number, columns: number) => void
}

export function createShapeField(options: ShapeFieldOptions): ShapeField {
  let rows = 0
  let columns = 0

  const wrap = document.createElement('span')
  wrap.className = 'block-editor__shape'
  if (options.title) wrap.title = options.title

  const note = document.createElement('span')
  note.className = 'block-editor__shape-note'

  const fields = document.createElement('span')
  fields.className = 'block-editor__shape-fields'
  fields.hidden = true

  const rowsInput = numberInput('rows')
  const columnsInput = numberInput('columns')
  const times = document.createElement('span')
  times.className = 'block-editor__shape-times'
  times.textContent = '×'
  fields.append(rowsInput, times, columnsInput)
  wrap.append(note, fields)

  const render = (): void => {
    note.textContent = rows > 0 ? `${rows} × ${columns}` : ''
    wrap.classList.toggle('block-editor__shape--empty', rows === 0)
  }

  const close = (commit: boolean): void => {
    if (fields.hidden) return
    fields.hidden = true
    note.hidden = false
    wrap.classList.remove('block-editor__shape--editing')
    if (commit) {
      const nextRows = read(rowsInput, rows)
      const nextColumns = read(columnsInput, columns)
      if (nextRows !== rows || nextColumns !== columns) {
        options.onCommit(nextRows, nextColumns)
        return
      }
    }
    options.onDone?.()
  }

  const open = (focus: HTMLInputElement): void => {
    if (rows === 0) return
    rowsInput.value = String(rows)
    columnsInput.value = String(columns)
    note.hidden = true
    fields.hidden = false
    wrap.classList.add('block-editor__shape--editing')
    focus.focus()
    focus.select()
  }

  // Each number opens the field it names, so double-clicking the 4 in `5 × 4`
  // puts the caret in the columns field rather than in the first one.
  note.addEventListener('dblclick', (event) => {
    const half = note.getBoundingClientRect().left + note.getBoundingClientRect().width / 2
    open(event.clientX > half ? columnsInput : rowsInput)
  })

  for (const input of [rowsInput, columnsInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        close(true)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        close(false)
      }
      // Everything typed in a header is chrome, not content: the keymap that
      // finishes the block must not see it — Escape here means "not this
      // number", not "throw the table away".
      event.stopPropagation()
    })
  }

  wrap.addEventListener('focusout', () => {
    // Tab from the rows field to the columns field is still editing the
    // shape, and the browser reports the new `activeElement` only after.
    requestAnimationFrame(() => {
      if (wrap.contains(document.activeElement)) return
      close(true)
    })
  })

  render()
  return {
    dom: wrap,
    setValue(nextRows: number, nextColumns: number) {
      rows = nextRows
      columns = nextColumns
      render()
    }
  }
}

function numberInput(name: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.inputMode = 'numeric'
  input.className = 'block-editor__shape-input'
  input.setAttribute('aria-label', name)
  input.spellcheck = false
  input.autocomplete = 'off'
  return input
}

/** What the author typed, or what the table already had if it wasn't a size. */
function read(input: HTMLInputElement, fallback: number): number {
  const value = Number.parseInt(input.value.trim(), 10)
  if (!Number.isFinite(value) || value < 1) return fallback
  // A table with a thousand rows is a typo, not a table.
  return Math.min(value, 200)
}
