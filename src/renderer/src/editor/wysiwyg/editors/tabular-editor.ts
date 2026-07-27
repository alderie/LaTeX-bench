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
//   - the shape is structure, so it's two buttons
//   - the source is the only thing left, so it's the only thing in the text
//     area — highlighted, because `&` and `\\` are what you navigate by
//
// and the preview underneath is the table itself, rendered by the same code
// that draws it when the editor is closed.

import { isTabularSource, renderTabular } from '../renderers/tabular'
import {
  addTabularColumn,
  addTabularRow,
  setTabularColumnSpec,
  tabularColumnSpec,
  tabularShape
} from '../renderers/tabular-edit'
import { createHeaderField, type HeaderField } from '../nodeviews/header-field'
import { CodeField } from './code-field'
import { bindFinishKeys, EditorPanel, panelButton, panelName, panelNote } from './editor-panel'

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
  private shapeNote: HTMLElement
  private colSpec: HeaderField
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

    const grid = document.createElement('span')
    grid.className = 'block-editor__grid'
    grid.appendChild(panelButton('rows', 'Add row', () => this.apply(addTabularRow), { plus: true }))
    grid.appendChild(
      panelButton('columns', 'Add column', () => this.apply(addTabularColumn), { plus: true })
    )
    this.panel.addControl(grid)

    this.shapeNote = panelNote('')
    this.panel.addControl(this.shapeNote)

    this.code = new CodeField({
      value: options.source,
      multiline: true,
      className: 'code-field--tabular',
      onInput: () => this.onInput()
    })
    this.panel.body.appendChild(this.code.dom)

    this.preview = this.panel.previewHost()
    this.preview.classList.add('block-editor__preview--tabular')

    this.paint()
    this.reflectShape()

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

  destroy(): void {
    /* nothing retained outside `dom` */
  }

  // ── Editing ──────────────────────────────────────────────────────────

  /** Run a source-to-source rewrite and keep the surface in step. */
  private apply(transform: (source: string) => string): void {
    this.code.value = transform(this.code.value)
    this.colSpec.setValue(tabularColumnSpec(this.code.value))
    this.code.focus()
    this.onInput()
  }

  private writeColumnSpec(spec: string): void {
    const next = setTabularColumnSpec(this.code.value, spec)
    if (next === this.code.value) return
    this.code.value = next
    this.onInput()
  }

  private onInput(): void {
    this.schedulePaint()
    this.reflectShape()
  }

  private reflectShape(): void {
    const { rows, columns } = tabularShape(this.code.value)
    this.shapeNote.textContent = rows > 0 ? `${rows} × ${columns}` : ''
  }

  private schedulePaint(): void {
    if (this.paintQueued) return
    this.paintQueued = true
    requestAnimationFrame(() => {
      this.paintQueued = false
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
    this.preview.classList.toggle('block-editor__preview--invalid', !isTabularSource(source))
    if (!isTabularSource(source)) {
      const note = document.createElement('span')
      note.textContent = 'Not a complete tabular environment yet.'
      this.preview.replaceChildren(note)
      return
    }
    this.preview.replaceChildren(renderTabular(source))
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
