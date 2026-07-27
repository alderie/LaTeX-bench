import katex from 'katex'
import {
  addColumn,
  addRow,
  ENV_CHOICES,
  errorOffset,
  findGrids,
  gridCells,
  nextCell,
  parseMathShell,
  presentBody,
  removeColumn,
  removeRow,
  serializeMathShell,
  setCell,
  shellChoice,
  switchEnvironment,
  tidyErrorMessage,
  withLabelText,
  type GridRegion,
  type MathShell
} from '../math-source'
import { completionQuery, completionsFor, applyCompletion, type Completion } from '../math-complete'
import { getMathMacros } from '../math-macros'
import { createIcon } from '../icons'

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
//   - the grid shape is structure, so a matrix in the formula gets a grid of
//     cells to type into, with row and column controls on its edges
//   - the maths is the only thing left, so it's the only thing in the text
//     area — dedented, with the wrapper gone
//
// and `\` completes, listing the paper's own macros first.
//
// All of it is plain DOM. This lives inside a ProseMirror node view, and
// putting a React root between a keystroke and its repaint is what made the
// old preview stutter on a long `align`.

export interface FormulaEditorOptions {
  latex: string
  displayMode: boolean
  /** Called with the new full source when the author is done. */
  onCommit: (latex: string) => void
  /** Called when the author abandons the edit. */
  onCancel: () => void
}

const COMMIT_HINT = '⌘⏎ done · esc revert'

export class FormulaEditor {
  readonly dom: HTMLElement
  private shell: MathShell
  private field: HTMLInputElement | HTMLTextAreaElement
  private preview: HTMLElement | null = null
  private completions: CompletionPopup | null = null
  private gridHost: HTMLElement | null = null
  private gridSignature = ''
  private cells: CellHandle[] = []
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

    this.dom = document.createElement('div')
    this.dom.className = options.displayMode ? 'formula-editor' : 'formula-editor--inline'

    this.field = options.displayMode ? this.buildTextarea() : this.buildInput()

    if (options.displayMode) {
      this.dom.appendChild(this.buildBar())
      this.dom.appendChild(this.field)
      this.gridHost = document.createElement('div')
      this.gridHost.className = 'formula-editor__grids'
      this.dom.appendChild(this.gridHost)
      this.preview = document.createElement('div')
      this.preview.className = 'math-preview'
      this.dom.appendChild(this.preview)
      this.paint()
      this.renderGrids()
    } else {
      this.dom.appendChild(this.field)
    }

    this.completions = new CompletionPopup((completion) => this.accept(completion))
    this.field.addEventListener('input', () => this.onInput())
    this.field.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    this.field.addEventListener('blur', () => this.onBlur())
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
      if (el instanceof HTMLTextAreaElement) autosize(el)
    })
  }

  /** Ask the editor to finish, as the surrounding view moving on would. */
  blur(): void {
    this.field.blur()
  }

  destroy(): void {
    this.completions?.destroy()
    this.completions = null
  }

  // ── Chrome ───────────────────────────────────────────────────────────

  private buildBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'formula-editor__bar'

    const choice = shellChoice(this.shell)
    if (choice !== null) {
      const select = document.createElement('select')
      select.className = 'formula-editor__env'
      select.title = 'Environment'
      for (const option of ENV_CHOICES) {
        const el = document.createElement('option')
        el.value = option.value
        el.textContent = option.label
        select.appendChild(el)
      }
      select.value = choice
      // `change`, not `input`: switching environment can rewrite the body,
      // and doing that while the author is still arrowing through the list
      // would rewrite it once per keypress.
      select.addEventListener('change', () => this.switchEnv(select.value))
      // The select steals focus from the field; putting it back keeps the
      // caret where it was so the author can carry on typing.
      select.addEventListener('mousedown', (e) => e.stopPropagation())
      bar.appendChild(select)
    } else if (this.shell.kind === 'env') {
      const name = document.createElement('span')
      name.className = 'formula-editor__env-name'
      name.textContent = this.shell.env
      bar.appendChild(name)
    }

    if (this.shell.label !== null || this.canCarryLabel()) {
      bar.appendChild(this.buildLabelField())
    }

    const spacer = document.createElement('span')
    spacer.className = 'formula-editor__spacer'
    bar.appendChild(spacer)

    const hint = document.createElement('span')
    hint.className = 'formula-editor__hint'
    hint.textContent = COMMIT_HINT
    bar.appendChild(hint)

    return bar
  }

  /** Numbered environments are the ones worth referring to by label. */
  private canCarryLabel(): boolean {
    return this.shell.kind === 'env' && !this.shell.starred
  }

  private buildLabelField(): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'formula-editor__label'
    wrap.appendChild(createIcon('tag', 12))

    const input = document.createElement('input')
    input.type = 'text'
    input.value = this.shell.label ?? ''
    input.placeholder = 'label'
    input.spellcheck = false
    input.className = 'formula-editor__label-input'
    input.title = 'Reference name for \\ref and \\cref'
    input.addEventListener('input', () => {
      this.shell = withLabelText(this.shell, input.value)
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        this.field.focus()
      }
    })
    wrap.appendChild(input)
    return wrap
  }

  private buildTextarea(): HTMLTextAreaElement {
    const el = document.createElement('textarea')
    el.className = 'math-block__editor'
    el.value = this.initialBody
    el.spellcheck = false
    el.rows = Math.max(2, this.initialBody.split('\n').length)
    el.addEventListener('input', () => autosize(el))
    requestAnimationFrame(() => autosize(el))
    return el
  }

  private buildInput(): HTMLInputElement {
    const el = document.createElement('input')
    el.type = 'text'
    el.className = 'math-inline__editor'
    el.value = this.original
    el.spellcheck = false
    el.autocomplete = 'off'
    return el
  }

  // ── Editing ──────────────────────────────────────────────────────────

  private switchEnv(choice: string): void {
    const result = switchEnvironment(this.shell, choice, this.field.value)
    this.shell = result.shell
    this.field.value = result.body
    if (this.field instanceof HTMLTextAreaElement) autosize(this.field)
    this.field.focus()
    this.schedulePaint()
    this.renderGrids()
  }

  private onInput(): void {
    this.schedulePaint()
    this.updateCompletions()
    this.renderGrids()
  }

  private updateCompletions(): void {
    if (!this.completions) return
    const caret = this.field.selectionStart ?? this.field.value.length
    const query = completionQuery(this.field.value, caret)
    if (!query) {
      this.completions.hide()
      return
    }
    const items = completionsFor(query.word, userMacroNames())
    if (items.length === 0) {
      this.completions.hide()
      return
    }
    this.completions.show(items, caretPoint(this.field))
  }

  private accept(completion: Completion): void {
    const caret = this.field.selectionStart ?? this.field.value.length
    const query = completionQuery(this.field.value, caret)
    if (!query) return
    const result = applyCompletion(this.field.value, query.from, caret, completion)
    this.field.value = result.value
    this.field.setSelectionRange(result.caret, result.caret)
    this.completions?.hide()
    this.field.focus()
    if (this.field instanceof HTMLTextAreaElement) autosize(this.field)
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
   * Tab across the grid the caret is in. At the last cell there is nowhere
   * to go, so make somewhere — every table editor in existence grows on Tab,
   * and stopping dead at the corner is the behaviour people file bugs about.
   */
  private moveCell(direction: 1 | -1): void {
    const caret = this.field.selectionStart ?? 0
    const region = this.regions().find((r) => caret >= r.from && caret <= r.to)
    const from = region?.from ?? 0
    const to = region?.to ?? this.field.value.length
    const target = nextCell(this.field.value.slice(from, to), caret - from, direction)
    if (target) {
      this.field.setSelectionRange(from + target.to, from + target.to)
      return
    }
    if (direction === -1 || !region) return
    this.rewriteRegion(region, addColumn)
    this.field.focus()
  }

  // ── The grid ─────────────────────────────────────────────────────────
  //
  // Matrices used to be two buttons on the toolbar that added a row or a
  // column to whatever the top-level structure happened to be. That was
  // wrong twice over: it did nothing useful for a matrix *nested* inside an
  // equation (the usual case), and counting ampersands is still how you had
  // to find the cell you wanted to change. So a formula containing a grid
  // now shows that grid, one input per cell, without being asked.

  private regions(): GridRegion[] {
    return findGrids(this.shell, this.field.value)
  }

  /** Run a transform over one grid's contents, leaving the rest of the body. */
  private rewriteRegion(region: GridRegion | undefined, transform: (inner: string) => string): void {
    if (!region) return
    const value = this.field.value
    const inner = value.slice(region.from, region.to)
    this.field.value = value.slice(0, region.from) + transform(inner) + value.slice(region.to)
    if (this.field instanceof HTMLTextAreaElement) autosize(this.field)
    this.renderGrids(true)
    this.schedulePaint()
  }

  private writeCell(index: number, row: number, column: number, text: string): void {
    // Regions are re-derived rather than remembered: every edit shifts the
    // offsets of everything after it in the body.
    const region = this.regions()[index]
    if (!region) return
    const value = this.field.value
    const inner = setCell(value.slice(region.from, region.to), row, column, text)
    this.field.value = value.slice(0, region.from) + inner + value.slice(region.to)
    if (this.field instanceof HTMLTextAreaElement) autosize(this.field)
    this.schedulePaint()
  }

  private renderGrids(force = false): void {
    const host = this.gridHost
    if (!host) return
    const body = this.field.value
    const regions = this.regions()
    if (regions.length === 0) {
      host.replaceChildren()
      this.gridSignature = ''
      this.cells = []
      return
    }

    const tables = regions.map((region) => gridCells(body.slice(region.from, region.to)))
    const signature = regions
      .map((r, i) => `${r.env}:${tables[i].length}x${widthOf(tables[i])}`)
      .join('|')

    // Same shape as last time: resync the text instead of rebuilding, so
    // editing the source updates the grid without destroying the element the
    // author is typing into.
    if (!force && signature === this.gridSignature) {
      for (const cell of this.cells) {
        if (cell.input === document.activeElement) continue
        const value = tables[cell.region]?.[cell.row]?.[cell.column] ?? ''
        if (cell.input.value !== value) cell.input.value = value
      }
      return
    }

    this.gridSignature = signature
    this.cells = []
    host.replaceChildren(
      ...regions.map((region, index) =>
        this.buildGrid(region, tables[index], index, regions.length > 1)
      )
    )
  }

  private buildGrid(
    region: GridRegion,
    rows: string[][],
    index: number,
    named: boolean
  ): HTMLElement {
    const panel = document.createElement('div')
    panel.className = 'formula-grid'
    const columns = widthOf(rows)

    if (named) {
      const name = document.createElement('span')
      name.className = 'formula-grid__env'
      name.textContent = region.env
      panel.appendChild(name)
    }

    const table = document.createElement('div')
    table.className = 'formula-grid__table'
    // `auto` columns plus a per-cell `size`: the grid then sits at the width
    // of its widest entry instead of stretching across the editor, which is
    // what makes a 2×2 matrix read as a matrix and not as a form.
    table.style.gridTemplateColumns = `repeat(${columns}, auto) auto`

    rows.forEach((row, r) => {
      for (let c = 0; c < columns; c++) {
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'formula-grid__cell'
        input.spellcheck = false
        input.value = row[c] ?? ''
        input.size = Math.min(44, Math.max(4, (row[c] ?? '').length + 1))
        input.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}`)
        input.addEventListener('input', () => this.writeCell(index, r, c, input.value))
        input.addEventListener('keydown', (event) =>
          this.onCellKey(event, index, r, c, rows.length, columns)
        )
        this.cells.push({ input, region: index, row: r, column: c })
        table.appendChild(input)
      }
      table.appendChild(
        stripButton(`Remove row ${r + 1}`, rows.length > 1, () =>
          this.rewriteRegion(this.regions()[index], (inner) => removeRow(inner, r))
        )
      )
    })

    // A footer of column controls, sitting under the columns they act on.
    for (let c = 0; c < columns; c++) {
      table.appendChild(
        stripButton(`Remove column ${c + 1}`, columns > 1, () =>
          this.rewriteRegion(this.regions()[index], (inner) => removeColumn(inner, c))
        )
      )
    }
    table.appendChild(document.createElement('span'))
    panel.appendChild(table)

    const actions = document.createElement('div')
    actions.className = 'formula-grid__actions'
    actions.appendChild(
      addButton('rows', 'Row', () => this.grow(index, addRow, rows.length, 0))
    )
    actions.appendChild(
      addButton('columns', 'Column', () => this.grow(index, addColumn, 0, columns))
    )
    panel.appendChild(actions)
    return panel
  }

  /** Add a row or a column, then put the caret in the first cell of it. */
  private grow(
    index: number,
    transform: (inner: string) => string,
    row: number,
    column: number
  ): void {
    const region = this.regions()[index]
    if (!region) return
    this.rewriteRegion(region, transform)
    const created = this.cells.find(
      (cell) => cell.region === index && cell.row === row && cell.column === column
    )
    created?.input.focus()
  }

  private onCellKey(
    event: KeyboardEvent,
    index: number,
    row: number,
    column: number,
    rows: number,
    columns: number
  ): void {
    // Keystrokes here belong to the grid, not to the document underneath.
    event.stopPropagation()

    if (event.key === 'Escape') {
      event.preventDefault()
      this.finish(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.metaKey || event.ctrlKey) {
        this.finish(true)
        return
      }
      if (row === rows - 1) this.grow(index, addRow, rows, 0)
      else this.focusCell(index, row + 1, column)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const flat = row * columns + column + (event.shiftKey ? -1 : 1)
      if (flat < 0) return
      if (flat >= rows * columns) {
        this.grow(index, addRow, rows, 0)
        return
      }
      this.focusCell(index, Math.floor(flat / columns), flat % columns)
      return
    }
    const step = ARROWS[event.key]
    if (step && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      this.focusCell(index, row + step[0], column + step[1])
    }
  }

  private focusCell(index: number, row: number, column: number): void {
    const cell = this.cells.find(
      (entry) => entry.region === index && entry.row === row && entry.column === column
    )
    if (!cell) return
    cell.input.focus()
    cell.input.select()
  }

  private schedulePaint(): void {
    if (!this.preview || this.paintQueued) return
    this.paintQueued = true
    requestAnimationFrame(() => {
      this.paintQueued = false
      this.paint()
    })
  }

  private paint(): void {
    const preview = this.preview
    if (!preview) return
    preview.classList.remove('math-preview--error')
    preview.replaceChildren()
    const source = this.field.value.trim()
    if (source === '') return
    try {
      katex.render(this.renderable(), preview, {
        throwOnError: true,
        displayMode: true,
        strict: false,
        macros: getMathMacros()
      })
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

/** One cell input, tagged with where it sits so a resync can find it. */
interface CellHandle {
  input: HTMLInputElement
  region: number
  row: number
  column: number
}

const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1]
}

function widthOf(rows: string[][]): number {
  return Math.max(1, ...rows.map((row) => row.length))
}

function addButton(
  icon: Parameters<typeof createIcon>[0],
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'formula-grid__add'
  button.title = `Add ${label.toLowerCase()}`
  button.appendChild(createIcon(icon, 13))
  button.appendChild(createIcon('plus', 9))
  const text = document.createElement('span')
  text.textContent = label
  button.appendChild(text)
  // mousedown would blur the field and commit before the click ran.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', onClick)
  return button
}

/**
 * A remove control on the edge of the grid. Rendered even when there is
 * nothing left to remove — an empty slot keeps the row and column strips
 * from reflowing every time the grid changes size.
 */
function stripButton(label: string, enabled: boolean, onClick: () => void): HTMLElement {
  if (!enabled) {
    const blank = document.createElement('span')
    blank.className = 'formula-grid__strip'
    return blank
  }
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'formula-grid__strip formula-grid__strip--active'
  button.title = label
  button.setAttribute('aria-label', label)
  button.textContent = '−'
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', onClick)
  return button
}

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
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
