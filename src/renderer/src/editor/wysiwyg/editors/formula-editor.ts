import katex from 'katex'
import {
  addColumn,
  addRow,
  ENV_CHOICES,
  errorOffset,
  gridCells,
  gridSpans,
  nextCell,
  parseMathShell,
  presentBody,
  rewriteGrid,
  serializeMathShell,
  shellChoice,
  switchEnvironment,
  tidyErrorMessage,
  withLabelText,
  writeCell,
  type MathShell
} from '../math-source'
import {
  applyCompletion,
  completionQuery,
  completionsFor,
  structureQuery,
  structuresFor,
  type Completion
} from '../math-complete'
import { getMathMacros } from '../math-macros'
import { createIcon } from '../icons'
import { createDropdown, type Dropdown } from '../dropdown'
import { markMathCells } from '../renderers/math-cells'
import { CellEditor, type CellSite } from './cell-editor'
import { CodeField } from './code-field'
import { EditorPanel, panelButton, panelName } from './editor-panel'

// The formula editing surface.
//
// What it replaced was a textarea containing the node's LaTeX verbatim. That
// is the honest representation, and it is also the reason editing a formula
// felt like editing a config file: to unnumber an equation you retyped
// `\begin{equation}` and `\end{equation}` and had to keep them agreeing; to
// add a matrix row you counted ampersands; to remember whether the preamble
// defined `\inner` or `\ip` you closed the editor and went looking.
//
// So the surface is split by what each part *is*:
//
//   - the environment is a choice, so it's a dropdown
//   - the label is metadata, so it's a field (when detaching it is safe —
//     see math-source, which leaves per-row labels in an `align` alone)
//   - the grid shape is structure, so it's two buttons and the Tab key
//   - the maths is the only thing left, so it's the only thing in the text
//     area — dedented, with the wrapper gone
//
// and `\` completes, listing the paper's own macros first.
//
// The typeset formula underneath is not only a preview: every cell of every
// grid in it can be clicked and typed into, which is where matrices are
// edited now. The previous answer to "edit this matrix as a matrix" was a
// separate view of boxes you had to switch to, and it appeared only when the
// whole formula was one matrix — so the common `H = \begin{pmatrix}…` had
// nothing to click. See `renderers/math-cells`, which traces a rendered cell
// back to the characters it came from.
//
// The chrome around all that — the bar, the hint, the delete button, the
// preview strip — is `EditorPanel`, shared with the table and preamble
// editors so the three read as one editor with three subjects.

export interface FormulaEditorOptions {
  latex: string
  displayMode: boolean
  /** Called with the new full source when the author is done. */
  onCommit: (latex: string) => void
  /** Called when the author abandons the edit. */
  onCancel: () => void
  /**
   * Remove the formula entirely. Offered in the bar because the margin handle
   * that deletes a block is unreachable while its editor is open — the editor
   * is what's under the pointer.
   */
  onDelete?: () => void
}

export class FormulaEditor {
  readonly dom: HTMLElement
  private panel: EditorPanel
  private shell: MathShell
  private code: CodeField
  private field: HTMLInputElement | HTMLTextAreaElement
  private preview: HTMLElement | null = null
  private completions: CompletionPopup | null = null
  private gridControls: HTMLElement | null = null
  private envDropdown: Dropdown | null = null
  private cellEditor: CellEditor | null = null
  private cells: CellSite[] = []
  /**
   * Which grid the row and column buttons act on.
   *
   * A formula can hold several — `H` and `H^{-1}` side by side — and "add a
   * row" has to mean one of them. It means the last one touched, which is the
   * one the author is looking at.
   */
  private activeGrid = 0
  private readonly original: string
  private readonly initialBody: string
  private readonly initialChoice: string | null
  private readonly initialLabel: string | null
  private finished = false
  private paintQueued = false

  constructor(private options: FormulaEditorOptions) {
    this.original = options.latex
    this.shell = parseMathShell(options.latex)
    this.initialBody = presentBody(this.shell)
    this.initialChoice = shellChoice(this.shell)
    this.initialLabel = this.shell.label

    this.panel = new EditorPanel({
      variant: 'formula',
      inline: !options.displayMode,
      onDelete: options.onDelete && (() => this.deleteSelf()),
      deleteTitle: 'Delete this equation'
    })
    this.dom = this.panel.dom

    this.code = options.displayMode ? this.buildTextarea() : this.buildInput()
    this.field = this.code.input

    if (options.displayMode) {
      this.buildBar()
      this.panel.body.appendChild(this.code.dom)
      this.preview = this.panel.previewHost()
      this.preview.classList.add('math-preview')
      this.cellEditor = new CellEditor({
        host: this.preview,
        read: (cell) => this.field.value.slice(cell.from, cell.to),
        write: (cell, text) => this.writeCellText(cell, text),
        repaint: () => this.repaint(),
        grow: (cell, what) => this.growGrid(what, cell.grid),
        onDone: () => this.focus(),
        onCommitBlock: () => this.finish(true)
      })
      this.paint()
      this.updateGridControls()
    } else {
      this.panel.body.appendChild(this.code.dom)
    }

    this.completions = new CompletionPopup((completion) => this.accept(completion))
    this.field.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    // On the subtree rather than the field: the cell fields in the preview,
    // the label and the environment list are all part of "still editing this
    // formula", and a per-field blur handler would have to enumerate them.
    this.dom.addEventListener('focusout', () => this.onBlur())
  }

  focus(): void {
    const el = this.field
    requestAnimationFrame(() => {
      el.focus()
      const end = el.value.length
      try {
        el.setSelectionRange(end, end)
      } catch {
        /* a detached field; nothing to place */
      }
      this.code.refresh()
    })
  }

  /** Ask the editor to finish, as the surrounding view moving on would. */
  blur(): void {
    this.field.blur()
  }

  destroy(): void {
    this.completions?.destroy()
    this.completions = null
    this.envDropdown?.destroy()
    this.envDropdown = null
    this.cellEditor?.destroy()
    this.cellEditor = null
  }

  // ── Chrome ───────────────────────────────────────────────────────────

  private buildBar(): void {
    const choice = shellChoice(this.shell)
    if (choice !== null) {
      // A custom list rather than a native `<select>`: the OS popup can't
      // carry the shape glyphs, and it renders in the system's colours rather
      // than the editor's. `onChange` fires on commit, not on arrow-through —
      // switching environment rewrites the body, and doing that once per
      // keypress while the author scans the list would be destructive.
      this.envDropdown = createDropdown({
        options: ENV_CHOICES,
        value: choice,
        className: 'block-editor__env',
        title: 'Environment',
        onChange: (value) => this.switchEnv(value)
      })
      this.panel.addControl(this.envDropdown.dom)
    } else if (this.shell.kind === 'env') {
      this.panel.addControl(panelName(this.shell.env))
    }

    if (this.shell.label !== null || this.canCarryLabel()) {
      this.panel.addControl(this.buildLabelField())
    }

    this.gridControls = document.createElement('span')
    this.gridControls.className = 'block-editor__grid'
    this.gridControls.appendChild(
      panelButton('rows', 'Add row', () => this.growFromBar('row'), { plus: true })
    )
    this.gridControls.appendChild(
      panelButton('columns', 'Add column', () => this.growFromBar('column'), { plus: true })
    )
    this.panel.addControl(this.gridControls)
  }

  /** Numbered environments are the ones worth referring to by label. */
  private canCarryLabel(): boolean {
    return this.shell.kind === 'env' && !this.shell.starred
  }

  /**
   * The label field. It reads as a filled field with its own caption rather
   * than as another icon button, because it is the only control in the bar
   * that takes typing — and an empty one is the difference between an equation
   * you can cross-reference and one you can't.
   */
  private buildLabelField(): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'block-editor__label'
    wrap.appendChild(createIcon('tag', 12))

    const caption = document.createElement('span')
    caption.className = 'block-editor__label-caption'
    caption.textContent = 'label'
    wrap.appendChild(caption)

    const input = document.createElement('input')
    input.type = 'text'
    input.value = this.shell.label ?? ''
    input.placeholder = 'eq:name'
    input.spellcheck = false
    input.className = 'block-editor__label-input'
    input.title = 'Reference name for \\ref and \\cref'
    const reflect = (): void => {
      wrap.classList.toggle('block-editor__label--set', input.value.trim() !== '')
    }
    reflect()
    input.addEventListener('input', () => {
      this.shell = withLabelText(this.shell, input.value)
      reflect()
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        // Escape here dismisses the field, not the formula, so keep it from
        // reaching the subtree handler that would revert the whole edit.
        event.stopPropagation()
        this.field.focus()
      }
    })
    wrap.appendChild(input)
    return wrap
  }

  private buildTextarea(): CodeField {
    return new CodeField({
      value: this.initialBody,
      multiline: true,
      className: 'code-field--math',
      onInput: () => this.onInput()
    })
  }

  private buildInput(): CodeField {
    return new CodeField({
      value: this.original,
      multiline: false,
      className: 'code-field--math-inline',
      placeholder: 'x^2',
      onInput: () => this.onInput()
    })
  }

  // ── Editing ──────────────────────────────────────────────────────────

  private switchEnv(choice: string): void {
    // Any open cell is holding offsets into a body about to be rewritten.
    this.cellEditor?.close()
    const result = switchEnvironment(this.shell, choice, this.field.value)
    this.shell = result.shell
    this.code.value = result.body
    this.schedulePaint()
    this.updateGridControls()
    this.focus()
  }

  // ── The cells in the rendering ───────────────────────────────────────

  /** Write a cell's new text into the body, from an edit in the preview. */
  private writeCellText(cell: CellSite, text: string): number {
    const result = writeCell(this.field.value, cell.from, cell.to, text)
    this.code.value = result.body
    this.activeGrid = cell.grid
    this.updateGridControls()
    return result.to
  }

  /** Redraw the formula now — not on the next frame — and re-find its cells. */
  private repaint(): CellSite[] {
    this.paint()
    return this.cells
  }

  /**
   * Add a row or a column to one grid of the formula.
   *
   * To *one* grid: the body of `H = \begin{pmatrix}…\end{pmatrix}, \quad
   * H^{-1} = …` is not itself a grid, and the row break a whole-body rewrite
   * used to add landed between the two matrices rather than inside either.
   */
  private growGrid(what: 'row' | 'column', grid = this.activeGrid): void {
    const spans = gridSpans(this.shell, this.field.value)
    const span = spans[grid] ?? spans[0]
    if (!span) return
    this.activeGrid = spans.indexOf(span)
    this.code.value = rewriteGrid(this.field.value, span, what === 'row' ? addRow : addColumn)
    this.updateGridControls()
  }

  /**
   * Grow the active grid from the bar, then land in the cell that made.
   *
   * In the rendering when there is one to click, since that is where the
   * author is looking; in the source otherwise, which is all a formula that
   * doesn't render has.
   */
  private growFromBar(what: 'row' | 'column'): void {
    this.cellEditor?.close()
    this.growGrid(what)
    const target = this.newestCell(what, this.activeGrid)
    this.paint()
    if (target && this.cellEditor?.openAt(this.activeGrid, target.row, target.column)) return
    this.field.focus()
    if (target) this.field.setSelectionRange(target.to, target.to)
  }

  /** Where the cell a grow just created is: last row, or last column. */
  private newestCell(
    what: 'row' | 'column',
    grid: number
  ): { row: number; column: number; to: number } | null {
    const span = gridSpans(this.shell, this.field.value)[grid]
    if (!span) return null
    const cells = gridCells(this.field.value, span)
    if (cells.length === 0) return null
    const lastRow = Math.max(...cells.map((cell) => cell.row))
    const lastColumn = Math.max(...cells.map((cell) => cell.column))
    return (
      cells.find((cell) =>
        what === 'row'
          ? cell.row === lastRow && cell.column === 0
          : cell.row === 0 && cell.column === lastColumn
      ) ?? null
    )
  }

  private onInput(): void {
    this.schedulePaint()
    this.updateCompletions()
    this.updateGridControls()
  }

  private updateGridControls(): void {
    if (!this.gridControls) return
    const spans = gridSpans(this.shell, this.field.value)
    if (this.activeGrid >= spans.length) this.activeGrid = 0
    this.gridControls.classList.toggle('block-editor__grid--off', spans.length === 0)
  }

  /**
   * What to suggest under the caret.
   *
   * Two triggers, in order. A `\word` completes macros, as before. Failing
   * that, a bare word of three letters or more is matched against the
   * multi-cell constructions — typing "matrix" or "piecewise" is what someone
   * reaches for before they remember it's spelled `\begin{pmatrix}`.
   */
  private currentQuery(): { from: number; word: string; items: Completion[] } | null {
    const caret = this.field.selectionStart ?? this.field.value.length
    const macro = completionQuery(this.field.value, caret)
    if (macro) {
      const items = completionsFor(macro.word, userMacroNames())
      return items.length > 0 ? { ...macro, items } : null
    }
    const structure = structureQuery(this.field.value, caret)
    if (structure) {
      const items = structuresFor(structure.word)
      return items.length > 0 ? { ...structure, items } : null
    }
    return null
  }

  private updateCompletions(): void {
    if (!this.completions) return
    const query = this.currentQuery()
    if (!query) {
      this.completions.hide()
      return
    }
    this.completions.show(query.items, caretPoint(this.field))
  }

  private accept(completion: Completion): void {
    const caret = this.field.selectionStart ?? this.field.value.length
    const query = this.currentQuery()
    if (!query) return
    const result = applyCompletion(this.field.value, query.from, caret, completion)
    this.code.value = result.value
    this.field.setSelectionRange(result.caret, result.caret)
    this.completions?.hide()
    this.field.focus()
    this.schedulePaint()
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.completions?.visible) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          this.completions.move(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          this.completions.move(-1)
          return
        case 'Enter':
        case 'Tab':
          event.preventDefault()
          this.completions.commit()
          return
        case 'Escape':
          // Close the list, not the editor: the author is dismissing a
          // suggestion, not throwing away their formula.
          event.preventDefault()
          this.completions.hide()
          return
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      this.finish(false)
      return
    }
    // Backspace with nothing left to delete takes the equation itself. The
    // keymap that does this for every other block can't see a key pressed in
    // here — the field is chrome, not part of the document.
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      this.field.value === '' &&
      this.options.onDelete
    ) {
      event.preventDefault()
      this.finished = true
      this.options.onDelete()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      this.finish(true)
      return
    }
    if (event.key === 'Enter' && !this.options.displayMode) {
      event.preventDefault()
      this.finish(true)
      return
    }
    if (event.key === 'Tab' && this.options.displayMode) {
      event.preventDefault()
      this.moveCell(event.shiftKey ? -1 : 1)
      return
    }
    // Arrow keys move the caret without firing `input`, and the suggestion
    // list is caret-relative, so it has to be re-derived here too.
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      requestAnimationFrame(() => this.updateCompletions())
    }
  }

  /**
   * Tab across the grid. At the last cell there is nowhere to go, so make
   * somewhere — every table editor in existence grows on Tab, and stopping
   * dead at the corner is the behaviour people file bugs about.
   */
  private moveCell(direction: 1 | -1): void {
    const caret = this.field.selectionStart ?? 0
    const target = nextCell(this.field.value, caret, direction)
    if (target) {
      this.field.setSelectionRange(target.to, target.to)
      return
    }
    if (direction === -1) return
    // The grid the caret is in, which for a formula holding two matrices is
    // not necessarily the one the bar's buttons would grow.
    const grid = gridForCaret(this.shell, this.field.value, caret)
    this.growGrid('column', grid)
    const span = gridSpans(this.shell, this.field.value)[grid]
    const cells = span ? gridCells(this.field.value, span) : []
    const made = cells[cells.length - 1]
    if (made) this.field.setSelectionRange(made.to, made.to)
    this.schedulePaint()
  }

  /** Remove the equation, editor and all. */
  private deleteSelf(): void {
    // Nothing left to commit, and the focusout that follows must not try.
    this.finished = true
    this.options.onDelete?.()
  }

  private schedulePaint(): void {
    if (!this.preview || this.paintQueued) return
    this.paintQueued = true
    requestAnimationFrame(() => {
      this.paintQueued = false
      // Redrawing under an open cell field would throw away the element it
      // is sitting on. Nothing is lost by waiting: the cell writes its text
      // through as it is typed, and finishing repaints.
      if (this.cellEditor?.active) return
      this.paint()
    })
  }

  private paint(): void {
    const preview = this.preview
    if (!preview) return
    preview.classList.remove('math-preview--error')
    preview.replaceChildren()
    this.cells = []
    this.cellEditor?.setCells(this.cells)
    const source = this.field.value.trim()
    if (source === '') return
    try {
      katex.render(this.renderable(), preview, {
        throwOnError: true,
        displayMode: true,
        strict: false,
        macros: getMathMacros()
      })
      this.cells = markMathCells(preview, this.shell, this.field.value)
      this.cellEditor?.setCells(this.cells)
    } catch (err) {
      preview.classList.add('math-preview--error')
      preview.appendChild(this.errorReport(err as Error))
    }
  }

  /**
   * What to hand KaTeX: the body inside its real environment, so `align`
   * previews as aligned rows rather than as one line, but without the
   * numbering wrapper — the numbers come from the document, not from here.
   */
  private renderable(): string {
    if (this.shell.kind !== 'env') return this.field.value
    const env = `${this.shell.env}*`
    return `\\begin{${env}}\n${this.field.value}\n\\end{${env}}`
  }

  /**
   * KaTeX names the offending token and gives its offset. The offset is the
   * useful half and the half a reader can't recover themselves, so the
   * message doubles as a button that puts the caret there.
   */
  private errorReport(err: Error): HTMLElement {
    const wrap = document.createElement('div')
    const message = document.createElement('span')
    message.textContent = tidyErrorMessage(err.message)
    wrap.appendChild(message)

    const offset = errorOffset(err.message)
    if (offset !== null) {
      const jump = document.createElement('button')
      jump.type = 'button'
      jump.className = 'math-preview__jump'
      jump.textContent = 'go to it'
      jump.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const at = Math.min(offset, this.field.value.length)
        this.field.focus()
        this.field.setSelectionRange(at, at)
      })
      wrap.appendChild(jump)
    }
    return wrap
  }

  // ── Finishing ────────────────────────────────────────────────────────

  private onBlur(): void {
    // Focus moving to the environment dropdown or the label field is still
    // editing this formula, so don't treat it as leaving.
    requestAnimationFrame(() => {
      if (this.finished) return
      if (this.dom.contains(document.activeElement)) return
      this.finish(true)
    })
  }

  private finish(commit: boolean): void {
    if (this.finished) return
    this.finished = true
    this.completions?.hide()
    if (!commit) {
      this.options.onCancel()
      return
    }
    this.options.onCommit(this.result())
  }

  /**
   * The new source — or the original string, byte for byte, when nothing
   * actually changed. Rebuilding an untouched formula would reformat it and
   * show up as a spurious edit in the saved `.tex`.
   */
  private result(): string {
    if (!this.options.displayMode) return this.field.value
    const unchanged =
      this.field.value === this.initialBody &&
      shellChoice(this.shell) === this.initialChoice &&
      this.shell.label === this.initialLabel
    return unchanged ? this.original : serializeMathShell(this.shell, this.field.value)
  }
}

// ── The completion list ────────────────────────────────────────────────

class CompletionPopup {
  private dom: HTMLElement
  private items: Completion[] = []
  private selected = 0
  visible = false

  constructor(private onAccept: (completion: Completion) => void) {
    this.dom = document.createElement('div')
    this.dom.className = 'math-complete'
    this.dom.setAttribute('role', 'listbox')
    this.dom.style.display = 'none'
    document.body.appendChild(this.dom)
  }

  show(items: Completion[], at: { left: number; top: number } | null): void {
    const sameList =
      items.length === this.items.length && items.every((it, i) => it.name === this.items[i].name)
    this.items = items
    if (!sameList) this.selected = 0
    this.visible = true
    this.render()
    if (at) {
      const height = this.dom.offsetHeight
      const flip = at.top + height + 24 > window.innerHeight
      this.dom.style.top = `${flip ? Math.max(8, at.top - height - 22) : at.top + 4}px`
      this.dom.style.left = `${Math.min(at.left, window.innerWidth - this.dom.offsetWidth - 12)}px`
    }
  }

  hide(): void {
    if (!this.visible) return
    this.visible = false
    this.dom.style.display = 'none'
    this.dom.replaceChildren()
  }

  move(direction: 1 | -1): void {
    if (this.items.length === 0) return
    this.selected = (this.selected + direction + this.items.length) % this.items.length
    this.highlight()
  }

  commit(): void {
    const item = this.items[this.selected]
    if (item) this.onAccept(item)
  }

  destroy(): void {
    this.dom.remove()
  }

  private render(): void {
    this.dom.replaceChildren()
    this.dom.style.display = 'block'
    this.items.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'math-complete__item'
      if (index === this.selected) row.classList.add('math-complete__item--active')
      row.setAttribute('role', 'option')

      const sample = document.createElement('span')
      sample.className = 'math-complete__sample'
      try {
        katex.render(item.preview, sample, {
          throwOnError: false,
          displayMode: false,
          strict: false,
          macros: getMathMacros()
        })
      } catch {
        sample.textContent = item.name
      }

      const name = document.createElement('span')
      name.className = 'math-complete__name'
      name.textContent = item.name
      const detail = document.createElement('span')
      detail.className = 'math-complete__detail'
      detail.textContent = item.detail

      row.append(sample, name, detail)
      // mousedown so the field never loses focus, which would commit the
      // whole formula before the click landed.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        this.selected = index
        this.commit()
      })
      row.addEventListener('mouseenter', () => {
        this.selected = index
        this.highlight()
      })
      this.dom.appendChild(row)
    })
  }

  private highlight(): void {
    const rows = this.dom.querySelectorAll('.math-complete__item')
    rows.forEach((row, i) => row.classList.toggle('math-complete__item--active', i === this.selected))
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Which grid the caret sits in, innermost first.
 *
 * Tab at the end of a matrix should grow *that* matrix, and a formula can
 * hold more than one — or one inside another, where the answer is the inner.
 */
function gridForCaret(shell: MathShell, body: string, caret: number): number {
  let best = 0
  let narrowest = Infinity
  gridSpans(shell, body).forEach((span, index) => {
    if (caret < span.from || caret > span.to) return
    const width = span.to - span.from
    if (width >= narrowest) return
    narrowest = width
    best = index
  })
  return best
}

/** Macro names the current paper's preamble declared, for completion. */
function userMacroNames(): string[] {
  return Object.keys(getMathMacros()).filter(
    (name) => !['\\eqref', '\\label', '\\nonumber', '\\notag'].includes(name)
  )
}

/**
 * Where the caret is on screen, so the suggestion list can sit under it.
 *
 * A textarea exposes no caret geometry, so this measures a mirror: a hidden
 * div with the field's own metrics, holding the text up to the caret and a
 * marker after it. Anchoring to the field's corner instead would be simpler,
 * but the list would sit a line and a half from what it is completing.
 */
function caretPoint(field: HTMLInputElement | HTMLTextAreaElement): { left: number; top: number } | null {
  const rect = field.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  const caret = field.selectionStart ?? field.value.length

  const style = window.getComputedStyle(field)
  const mirror = document.createElement('div')
  for (const property of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderLeftWidth',
    'textIndent'
  ] as const) {
    mirror.style[property] = style[property]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre'
  mirror.style.wordWrap = 'break-word'
  mirror.style.width = `${field.clientWidth}px`
  mirror.style.top = '0'
  mirror.style.left = '-9999px'

  mirror.textContent = field.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const left = marker.offsetLeft
  const top = marker.offsetTop + marker.offsetHeight
  mirror.remove()

  return {
    left: rect.left + left - field.scrollLeft,
    top: rect.top + top - field.scrollTop
  }
}
