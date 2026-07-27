// The table editing surface.
//
// A table used to open as a bare textarea full of `&` and `\\` — the same
// treatment any unrecognised block got — while the equation two paragraphs
// above it opened with an environment picker, a label field, row and column
// buttons and a live rendering underneath. Both are grids of maths inside a
// paper; there was no reason for one of them to be a config file.
//
// So a table now opens in the same panel as a formula, with the controls a
// table actually has:
//
//   - the environment names itself (`tabular`, `longtable`, …) — switching it
//     would change what arguments are required, which is not a one-click edit
//   - the column spec is metadata, so it's a field: `@{}llrr@{}` is the one
//     part of a table you edit as a string rather than as content
//   - the shape is a measurement, so it's a caption — one you can double-click
//     to set, since `5 × 4` is also the shortest way to say what you want
//   - the source is the only thing left, so it's the only thing in the text
//     area — highlighted, because `&` and `\\` are what you navigate by
//
// and the preview underneath is the table itself, rendered by the same code
// that draws it when the editor is closed — and editable in place: click the
// cell reading `4.81 \pm 0.92` and a small LaTeX field opens over it, Tab
// walks the row, and the source above follows along. Finding that number in
// the source instead means counting `&`s in a line that wraps twice.
//
// Growing the table is part of walking it — Tab past the last cell makes a
// column, Enter past the last row makes a row, or the shape in the bar says
// how many of each there should be — so the bar has no buttons for it. It had
// two, from when the source area was the only way in and a row break had to
// be typed by hand.

// A table's row is a run of `&`-separated cells, which is what this knows
// how to write into — the same rule that keeps a matrix's source readable.
import { writeCell } from '../math-source'
import { isTabularSource, renderEditableTabular } from '../renderers/tabular'
import {
  addTabularColumn,
  addTabularRow,
  setTabularColumnSpec,
  setTabularShape,
  tabularColumnSpec,
  tabularShape
} from '../renderers/tabular-edit'
import { createHeaderField, type HeaderField } from '../nodeviews/header-field'
import { CellEditor, type CellSite } from './cell-editor'
import { CodeField } from './code-field'
import { EditHistory } from './edit-history'
import { createShapeField, type ShapeField } from './shape-field'
import { bindFinishKeys, EditorPanel, panelName } from './editor-panel'

export interface TabularEditorOptions {
  source: string
  /** Called with the new source when the author is done. */
  onCommit: (source: string) => void
  /** Called when the author abandons the edit. */
  onCancel: () => void
  /** Remove the table entirely. */
  onDelete?: () => void
}

export class TabularEditor {
  readonly dom: HTMLElement
  private panel: EditorPanel
  private code: CodeField
  private preview: HTMLElement
  private shape: ShapeField
  private colSpec: HeaderField
  private cellEditor: CellEditor
  private cells: CellSite[] = []
  private history: EditHistory<string>
  private readonly original: string
  private finished = false
  private paintQueued = false

  constructor(private options: TabularEditorOptions) {
    this.original = options.source

    this.panel = new EditorPanel({
      variant: 'tabular',
      onDelete: options.onDelete && (() => this.deleteSelf()),
      deleteTitle: 'Delete this table'
    })
    this.dom = this.panel.dom

    this.panel.addControl(panelName(environmentOf(options.source)))

    this.colSpec = createHeaderField({
      caption: 'columns',
      placeholder: 'llr',
      icon: 'columns',
      mono: true,
      value: tabularColumnSpec(options.source),
      title: 'Column spec — l, c, r per column',
      onCommit: (value) => this.writeColumnSpec(value ?? ''),
      onDone: () => this.code.focus()
    })
    this.panel.addControl(this.colSpec.dom)

    this.shape = createShapeField({
      title: 'Rows × columns — double-click to set',
      onCommit: (rows, columns) => this.resize(rows, columns),
      onDone: () => this.code.focus()
    })
    this.panel.addControl(this.shape.dom)

    this.code = new CodeField({
      value: options.source,
      multiline: true,
      className: 'code-field--tabular',
      onInput: () => this.onInput()
    })
    this.panel.body.appendChild(this.code.dom)

    // ⌘Z walks these. The field's own undo can't: the cell fields in the
    // preview and the column spec write to it by assignment, which clears it.
    this.history = new EditHistory<string>(options.source, 0, {
      restore: (source, caret) => this.restore(source, caret)
    })

    this.preview = this.panel.previewHost()
    this.preview.classList.add('block-editor__preview--tabular')

    this.cellEditor = new CellEditor({
      host: this.preview,
      read: (cell) => this.code.value.slice(cell.from, cell.to),
      write: (cell, text) => this.writeCellText(cell, text),
      repaint: () => this.repaint(),
      grow: (_cell, what) => this.apply(what === 'row' ? addTabularRow : addTabularColumn),
      onDone: () => this.code.focus(),
      onCommitBlock: () => this.finish(true)
    })

    this.paint()
    this.reflectShape()

    // Capture, and on the whole panel: the undo keys have to be taken before
    // the field they were pressed in acts on them, whichever field that is.
    this.panel.dom.addEventListener(
      'keydown',
      (event) => {
        if (!this.history.handleKey(event)) return
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )

    bindFinishKeys(this.panel, this.code.input, {
      commit: () => this.finish(true),
      cancel: () => this.finish(false),
      isFinished: () => this.finished,
      onDelete: options.onDelete && (() => this.deleteSelf())
    })
  }

  focus(): void {
    requestAnimationFrame(() => {
      this.code.focus()
      // At the top, not the end: the first thing an author looks at in a
      // table they just opened is its header row.
      this.code.setSelectionRange(0, 0)
      this.code.input.scrollTop = 0
      this.code.refresh()
    })
  }

  /**
   * Open the cell that starts at `from`, if the table still has one there.
   *
   * This is how a click on a closed table lands in the cell that was clicked
   * rather than at the top of the source: the offsets a rendered table
   * carries are the same whether it is being edited or merely read.
   */
  openCell(from: number): boolean {
    const cell = this.cells.find((candidate) => candidate.from === from)
    return cell ? this.cellEditor.openAt(cell.grid, cell.row, cell.column) : false
  }

  destroy(): void {
    this.cellEditor.destroy()
  }

  // ── Undo ─────────────────────────────────────────────────────────────

  /** Note the current source, coalescing a run of keystrokes into one step. */
  private remember(kind: 'type' | 'step' = 'step'): void {
    this.history.record(this.code.value, this.code.input.selectionStart ?? 0, kind)
  }

  /** Put a remembered source back on every part of the surface. */
  private restore(source: string, caret: number): void {
    this.cellEditor.close()
    this.code.value = source
    this.colSpec.setValue(tabularColumnSpec(source))
    this.paint()
    this.reflectShape()
    this.code.focus()
    this.code.setSelectionRange(caret, caret)
  }

  // ── Editing ──────────────────────────────────────────────────────────

  /** Run a source-to-source rewrite and keep the surface in step. */
  private apply(transform: (source: string) => string): void {
    // Any open cell is holding offsets into the source about to be rewritten.
    this.cellEditor.close()
    this.code.value = transform(this.code.value)
    this.colSpec.setValue(tabularColumnSpec(this.code.value))
    this.code.focus()
    this.remember()
    this.onInput()
  }

  private writeColumnSpec(spec: string): void {
    const next = setTabularColumnSpec(this.code.value, spec)
    if (next === this.code.value) return
    this.cellEditor.close()
    this.code.value = next
    this.remember()
    this.onInput()
  }

  private onInput(): void {
    this.remember('type')
    this.schedulePaint()
    this.reflectShape()
  }

  private reflectShape(): void {
    const { rows, columns } = tabularShape(this.code.value)
    this.shape.setValue(rows, columns)
  }

  /**
   * Resize the table to the shape typed into the bar.
   *
   * The cells it makes are empty, so the edit isn't finished when the source
   * is: the caret goes to the first of them, in the rendering, which is where
   * the author was looking when they asked for it.
   */
  private resize(rows: number, columns: number): void {
    const before = new Set(this.cells.map((cell) => `${cell.row}:${cell.column}`))
    this.apply((source) => setTabularShape(source, { rows, columns }))
    this.paint()
    const made = this.cells.find(
      (cell) => cell.from === cell.to && !before.has(`${cell.row}:${cell.column}`)
    )
    if (made) this.cellEditor.openAt(made.grid, made.row, made.column)
  }

  /** Write a cell's new text into the source, from an edit in the preview. */
  private writeCellText(cell: CellSite, text: string): number {
    const result = writeCell(this.code.value, cell.from, cell.to, text)
    this.code.value = result.body
    this.reflectShape()
    // Typing in a cell coalesces the way typing in the source does, so undo
    // goes back to what the cell held rather than a letter at a time.
    this.history.record(this.code.value, cell.from, 'type')
    return result.to
  }

  /** Redraw the table now — not on the next frame — and re-find its cells. */
  private repaint(): CellSite[] {
    this.paint()
    return this.cells
  }

  private schedulePaint(): void {
    if (this.paintQueued) return
    this.paintQueued = true
    requestAnimationFrame(() => {
      this.paintQueued = false
      // Redrawing under an open cell field would throw away the element it
      // is sitting on, and the cell writes its text through as it is typed —
      // so there is nothing to lose by waiting for it to finish.
      if (this.cellEditor.active) return
      this.paint()
    })
  }

  /**
   * The table as it will look. When the source has stopped being a table at
   * all — a half-typed `\begin`, a deleted `\end` — say so rather than showing
   * the source back as if it had rendered.
   */
  private paint(): void {
    const source = this.code.value
    this.cells = []
    this.preview.classList.toggle('block-editor__preview--invalid', !isTabularSource(source))
    if (!isTabularSource(source)) {
      const note = document.createElement('span')
      note.textContent = 'Not a complete tabular environment yet.'
      this.preview.replaceChildren(note)
      this.cellEditor.setCells(this.cells)
      return
    }
    const rendering = renderEditableTabular(source)
    this.cells = rendering.cells
    this.preview.replaceChildren(rendering.dom)
    this.cellEditor.setCells(this.cells)
  }

  // ── Finishing ────────────────────────────────────────────────────────

  private deleteSelf(): void {
    // Nothing left to commit, and the focusout that follows must not try.
    this.finished = true
    this.options.onDelete?.()
  }

  private finish(commit: boolean): void {
    if (this.finished) return
    this.finished = true
    if (!commit) {
      this.options.onCancel()
      return
    }
    // Committing the field's own text, so an untouched table round-trips
    // byte for byte rather than showing up as an edit in the saved `.tex`.
    this.colSpec.commit()
    this.options.onCommit(this.code.value === this.original ? this.original : this.code.value)
  }
}

/** The environment's name, for the bar. */
function environmentOf(source: string): string {
  return /^\s*\\begin\{([A-Za-z]+\*?)\}/.exec(source)?.[1] ?? 'tabular'
}
