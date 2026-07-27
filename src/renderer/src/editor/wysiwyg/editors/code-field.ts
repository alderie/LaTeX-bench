// A text field that shows what it holds is LaTeX.
//
// A `<textarea>` cannot colour its own contents, and the surfaces that need
// colouring here — a formula body, a table, the preamble — are all textareas
// for good reasons: they auto-size, they sit inside a ProseMirror node view,
// and they are created and destroyed on every click.
//
// So the field is two layers. A `<pre>` holds the highlighted copy; the real
// textarea sits on top of it with transparent text, its own caret, and a
// selection tint faint enough to read through. Everything that decides where
// a glyph lands — font, size, line height, padding, wrapping — has to be
// identical on both layers or the colour slides off the text; that agreement
// lives in one place, the `.code-field` rules in App.css, rather than being
// re-stated by every caller.

import { paintLatex } from './latex-highlight'

export interface CodeFieldOptions {
  value: string
  /** A textarea when true, a single-line input when false. */
  multiline: boolean
  /** Extra class on the wrapper, for callers that need to size it. */
  className?: string
  /** Extra class on the input itself, for callers with existing styles. */
  inputClassName?: string
  placeholder?: string
  /** Grow to fit the content instead of scrolling. Textareas only. */
  autosize?: boolean
  /**
   * Colour the contents as LaTeX. Off for a field holding something else —
   * a `lstlisting` body is Python, and painting `\n` in it as a macro would
   * be a confident lie about what the author wrote.
   */
  highlight?: boolean
  onInput?: () => void
}

export class CodeField {
  readonly dom: HTMLElement
  readonly input: HTMLTextAreaElement | HTMLInputElement
  private readonly highlight: HTMLElement
  private readonly autosize: boolean
  private readonly coloured: boolean

  constructor(options: CodeFieldOptions) {
    this.autosize = options.multiline && options.autosize !== false
    this.coloured = options.highlight !== false

    this.dom = document.createElement('div')
    this.dom.className = `code-field code-field--${options.multiline ? 'block' : 'inline'}`
    if (!this.coloured) this.dom.classList.add('code-field--plain')
    if (options.className) this.dom.classList.add(options.className)

    this.highlight = document.createElement('pre')
    this.highlight.className = 'code-field__highlight'
    this.highlight.setAttribute('aria-hidden', 'true')

    const input = options.multiline
      ? document.createElement('textarea')
      : document.createElement('input')
    if (input instanceof HTMLInputElement) {
      input.type = 'text'
      input.autocomplete = 'off'
    }
    input.className = 'code-field__input'
    if (options.inputClassName) input.classList.add(options.inputClassName)
    input.value = options.value
    input.spellcheck = false
    if (options.placeholder) input.placeholder = options.placeholder
    this.input = input

    this.dom.append(this.highlight, input)

    input.addEventListener('input', () => {
      this.refresh()
      options.onInput?.()
    })
    // A textarea that has grown past its box scrolls; the layer behind it has
    // to scroll with it or the colour peels away from the text.
    input.addEventListener('scroll', () => this.syncScroll())

    this.paint()
    if (this.autosize) requestAnimationFrame(() => this.resize())
  }

  get value(): string {
    return this.input.value
  }

  /** Write a value in — from a transform, an environment switch, a grid. */
  set value(next: string) {
    this.input.value = next
    this.refresh()
  }

  /** Re-paint and re-measure after the value changed without an `input`. */
  refresh(): void {
    this.paint()
    if (this.autosize) this.resize()
    this.syncScroll()
  }

  focus(): void {
    this.input.focus()
  }

  setSelectionRange(from: number, to: number): void {
    try {
      this.input.setSelectionRange(from, to)
    } catch {
      /* a detached field, or an input type that has no selection */
    }
  }

  /** Height the field wants, so a caller can hand it back on reopen. */
  resize(): void {
    const el = this.input
    if (!(el instanceof HTMLTextAreaElement)) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  private paint(): void {
    if (!this.coloured) return
    paintLatex(this.input.value, this.highlight)
  }

  private syncScroll(): void {
    this.highlight.scrollTop = this.input.scrollTop
    this.highlight.scrollLeft = this.input.scrollLeft
  }
}
