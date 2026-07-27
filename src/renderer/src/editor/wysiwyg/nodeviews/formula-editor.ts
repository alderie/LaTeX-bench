import katex from 'katex'
import {
  addColumn,
  addRow,
  cellSpans,
  ENV_CHOICES,
  errorOffset,
  gridRegion,
  isGridBody,
  nextCell,
  parseMathShell,
  presentBody,
  serializeMathShell,
  shellChoice,
  switchEnvironment,
  tidyErrorMessage,
  withLabelText,
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
import { MatrixGrid } from './matrix-grid'

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
  private gridControls: HTMLElement | null = null
  private envDropdown: Dropdown | null = null
  private gridHost: HTMLElement | null = null
  private grid: MatrixGrid | null = null
  private sourceToggle: HTMLButtonElement | null = null
  /**
   * Whether to edit a grid as cells rather than as LaTeX.
   *
   * Defaults on for a matrix and off for `align`, even though both are grids.
   * A matrix is a table of short entries and reads as one; an `align` is a
   * derivation whose rows are long, and chopping those into fixed-width
   * inputs would be a worse text area, not a better table. The toggle in the
   * bar overrides either way.
   */
  private preferGrid = true
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
    // `env !== ''` is "the body is a matrix", as opposed to "the formula's own
    // environment happens to be a grid" — see `preferGrid`.
    this.preferGrid = (gridRegion(this.shell, this.field.value)?.env ?? '') !== ''

    if (options.displayMode) {
      this.dom.appendChild(this.buildBar())
      this.gridHost = document.createElement('div')
      this.gridHost.className = 'formula-editor__grid-host'
      this.dom.appendChild(this.gridHost)
      this.dom.appendChild(this.field)
      this.preview = document.createElement('div')
      this.preview.className = 'math-preview'
      this.dom.appendChild(this.preview)
      this.paint()
      this.updateGridControls()
      this.updateSurface()
    } else {
      this.dom.appendChild(this.field)
    }

    this.completions = new CompletionPopup((completion) => this.accept(completion))
    this.field.addEventListener('input', () => this.onInput())
    this.field.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    // On the subtree rather than the field: the grid's cells, the label and
    // the environment list are all part of "still editing this formula", and
    // a per-field blur handler would have to enumerate them.
    this.dom.addEventListener('focusout', () => this.onBlur())
    // Escape and ⌘⏎ have to work from a grid cell too, and those inputs are
    // built by MatrixGrid, which knows nothing about committing a formula.
    this.dom.addEventListener('keydown', (event) => this.onHostKeyDown(event))
  }

  focus(): void {
    if (this.grid && this.gridHost && !this.gridHost.hidden) {
      const grid = this.grid
      requestAnimationFrame(() => grid.focus())
      return
    }
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
    this.envDropdown?.destroy()
    this.envDropdown = null
    this.grid?.destroy()
    this.grid = null
  }

  // ── Chrome ───────────────────────────────────────────────────────────

  private buildBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'formula-editor__bar'

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
        className: 'formula-editor__env',
        title: 'Environment',
        onChange: (value) => this.switchEnv(value)
      })
      bar.appendChild(this.envDropdown.dom)
    } else if (this.shell.kind === 'env') {
      const name = document.createElement('span')
      name.className = 'formula-editor__env-name'
      name.textContent = this.shell.env
      bar.appendChild(name)
    }

    if (this.shell.label !== null || this.canCarryLabel()) {
      bar.appendChild(this.buildLabelField())
    }

    this.gridControls = document.createElement('span')
    this.gridControls.className = 'formula-editor__grid'
    this.gridControls.appendChild(
      iconButton('rows', 'Add row', () => this.applyToBody(addRow))
    )
    this.gridControls.appendChild(
      iconButton('columns', 'Add column', () => this.applyToBody(addColumn))
    )
    bar.appendChild(this.gridControls)

    // Only appears when there is a grid to switch away from — the cells view
    // is the default for a matrix, and this is the way back to the source for
    // anything the table can't express (a `\multicolumn`, a stray `\hline`).
    this.sourceToggle = iconButton('code', 'Edit as LaTeX', () => {
      this.preferGrid = !this.preferGrid
      this.updateSurface()
      this.focus()
    })
    this.sourceToggle.hidden = true
    bar.appendChild(this.sourceToggle)

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

  /**
   * The label field. It reads as a filled field with its own caption rather
   * than as another icon button, because it is the only control in the bar
   * that takes typing — and an empty one is the difference between an equation
   * you can cross-reference and one you can't.
   */
  private buildLabelField(): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'formula-editor__label'
    wrap.appendChild(createIcon('tag', 12))

    const caption = document.createElement('span')
    caption.className = 'formula-editor__label-caption'
    caption.textContent = 'label'
    wrap.appendChild(caption)

    const input = document.createElement('input')
    input.type = 'text'
    input.value = this.shell.label ?? ''
    input.placeholder = 'eq:name'
    input.spellcheck = false
    input.className = 'formula-editor__label-input'
    input.title = 'Reference name for \\ref and \\cref'
    const reflect = (): void => {
      wrap.classList.toggle('formula-editor__label--set', input.value.trim() !== '')
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
    el.placeholder = 'x^2'
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
    this.schedulePaint()
    this.updateGridControls()
    // `align` is a grid and `equation` isn't, so the surface itself changes.
    this.updateSurface()
    this.focus()
  }

  // ── The cells view ───────────────────────────────────────────────────

  /**
   * Show the grid when the formula has one and the author hasn't asked for the
   * source, and the text area otherwise. Called after anything that can change
   * whether a grid exists: typing, switching environment, toggling the view.
   */
  private updateSurface(): void {
    const host = this.gridHost
    if (!host) return
    const region = gridRegion(this.shell, this.field.value)
    const showGrid = region !== null && this.preferGrid

    if (this.sourceToggle) {
      this.sourceToggle.hidden = region === null
      this.sourceToggle.title = showGrid ? 'Edit as LaTeX' : 'Edit as a grid'
      this.sourceToggle.setAttribute('aria-label', this.sourceToggle.title)
      this.sourceToggle.classList.toggle('formula-editor__button--on', !showGrid)
    }
    // The row/column buttons are the source view's way to grow a grid; the
    // cells view grows by typing into the dashed edge, so they'd be noise.
    this.gridControls?.classList.toggle('formula-editor__grid--hidden', showGrid)

    host.hidden = !showGrid
    this.field.classList.toggle('math-block__editor--hidden', showGrid)
    if (!showGrid) {
      this.grid?.destroy()
      this.grid = null
      return
    }

    const body = this.field.value.slice(region!.from, region!.to)
    if (this.grid) {
      this.grid.setBody(body)
      return
    }
    this.grid = new MatrixGrid({ body, onChange: (next) => this.writeGrid(next) })
    host.replaceChildren(this.grid.dom)
  }

  /** Splice a body the grid rewrote back into the region it came from. */
  private writeGrid(gridBody: string): void {
    const region = gridRegion(this.shell, this.field.value)
    if (!region) return
    const value = this.field.value
    // A grid that is the whole body sits where it is; one inside a `\begin`
    // keeps the wrapper on its own lines, which is how it was written and how
    // the source view will show it if the author switches back.
    const text =
      region.env === ''
        ? gridBody
        : `\n${gridBody
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n')}\n`
    this.field.value = value.slice(0, region.from) + text + value.slice(region.to)
    if (this.field instanceof HTMLTextAreaElement) autosize(this.field)
    this.schedulePaint()
  }

  /**
   * Finish keys, for focus that lives in a cell. The text area has its own
   * handler, so skip anything originating there to avoid running twice.
   */
  private onHostKeyDown(event: KeyboardEvent): void {
    if (event.target === this.field) return
    if (!this.gridHost?.contains(event.target as Node)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.finish(false)
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      this.finish(true)
    }
  }

  /** Run a body transform, then put the caret in the cell it created. */
  private applyToBody(transform: (body: string) => string): void {
    const before = cellSpans(this.field.value).length
    const next = transform(this.field.value)
    this.field.value = next
    const spans = cellSpans(next)
    const target = spans[Math.min(before, spans.length - 1)]
    this.field.focus()
    if (target) this.field.setSelectionRange(target.to, target.to)
    if (this.field instanceof HTMLTextAreaElement) autosize(this.field)
    this.schedulePaint()
  }

  private onInput(): void {
    this.schedulePaint()
    this.updateCompletions()
    this.updateGridControls()
    this.updateSurface()
  }

  private updateGridControls(): void {
    if (!this.gridControls) return
    this.gridControls.classList.toggle(
      'formula-editor__grid--off',
      !isGridBody(this.shell, this.field.value)
    )
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
    this.applyToBody(addColumn)
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

function iconButton(
  icon: Parameters<typeof createIcon>[0],
  title: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'formula-editor__button'
  button.title = title
  button.setAttribute('aria-label', title)
  button.appendChild(createIcon(icon, 14))
  button.appendChild(createIcon('plus', 10))
  // mousedown would blur the field and commit before the click ran.
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
