// The plain-LaTeX editing surface: the preamble, and any block the parser
// kept as source because it had no better model for it.
//
// There is nothing to preview and nothing to switch — the whole point of
// these blocks is that they are the LaTeX itself — so the panel carries only
// what it needs: what this block is, how long it is, and the keys that end
// the edit. What it gains over the textarea it replaced is colour: a preamble
// is sixty lines of `\usepackage`, `\newcommand` and comments, and reading it
// as one undifferentiated grey wall is what made it feel like a file the
// editor had merely tolerated rather than a part of the document.

import { CodeField } from './code-field'
import { bindFinishKeys, EditorPanel, panelName, panelNote } from './editor-panel'

export interface SourceBlockEditorOptions {
  source: string
  /** Modifier class and, loosely, what kind of block this is. */
  variant: 'preamble' | 'raw'
  /** Shown at the head of the bar: `Preamble`, `Raw LaTeX`. */
  title: string
  onCommit: (source: string) => void
  onCancel: () => void
  onDelete?: () => void
  deleteTitle?: string
  /** Where the caret starts. The top for something long, the end for a line. */
  caretAt?: 'start' | 'end'
}

export class SourceBlockEditor {
  readonly dom: HTMLElement
  private panel: EditorPanel
  private code: CodeField
  private lines: HTMLElement
  private readonly original: string
  private finished = false

  constructor(private options: SourceBlockEditorOptions) {
    this.original = options.source

    this.panel = new EditorPanel({
      variant: options.variant,
      onDelete: options.onDelete && (() => this.deleteSelf()),
      deleteTitle: options.deleteTitle
    })
    this.dom = this.panel.dom

    this.panel.addControl(panelName(options.title))
    this.lines = panelNote(lineCount(options.source))
    this.panel.addControl(this.lines)

    this.code = new CodeField({
      value: options.source,
      multiline: true,
      className: `code-field--${options.variant}`,
      onInput: () => {
        this.lines.textContent = lineCount(this.code.value)
      }
    })
    this.panel.body.appendChild(this.code.dom)

    bindFinishKeys(this.panel, this.code.input, {
      commit: () => this.finish(true),
      cancel: () => this.finish(false),
      isFinished: () => this.finished,
      onDelete: options.onDelete && (() => this.deleteSelf())
    })
  }

  focus(): void {
    // Two frames: the first lets the browser apply the panel's CSS, the
    // second measures a field that has its real metrics.
    requestAnimationFrame(() => {
      this.code.refresh()
      requestAnimationFrame(() => {
        this.code.focus()
        const at = this.options.caretAt === 'end' ? this.code.value.length : 0
        this.code.setSelectionRange(at, at)
        if (at === 0) this.code.input.scrollTop = 0
      })
    })
  }

  destroy(): void {
    /* nothing retained outside `dom` */
  }

  private deleteSelf(): void {
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
    this.options.onCommit(this.code.value === this.original ? this.original : this.code.value)
  }
}

function lineCount(source: string): string {
  const count = source.split('\n').length
  return `${count} line${count === 1 ? '' : 's'}`
}
