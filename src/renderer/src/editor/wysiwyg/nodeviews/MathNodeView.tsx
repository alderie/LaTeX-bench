import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'

// Per-paper KaTeX macros distilled from the document's preamble
// (\newcommand, \DeclareMathOperator, …). Set by the WysiwygEditor when it
// loads/reloads a paper. Module-scoped on purpose: every MathView in the
// current document shares the same macro table, and reloading a different
// paper replaces it wholesale.
let currentMathMacros: Record<string, string> = {
  '\\eqref': '\\href{###1}{(\\text{#1})}',
  '\\label': '',
  '\\nonumber': '',
  '\\notag': ''
}
export function setMathMacros(macros: Record<string, string>): void {
  currentMathMacros = {
    '\\eqref': '\\href{###1}{(\\text{#1})}',
    '\\label': '',
    '\\nonumber': '',
    '\\notag': '',
    ...macros
  }
}

export function getMathMacros(): Record<string, string> {
  return currentMathMacros
}

class MathView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement
  private editing = false
  private editor?: HTMLInputElement | HTMLTextAreaElement

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private displayMode: boolean
  ) {
    this.dom = document.createElement(displayMode ? 'div' : 'span')
    this.dom.className = displayMode ? 'math-block' : 'math-inline'
    this.dom.contentEditable = 'false'
    this.render()

    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      if (!this.editing) this.openEditor()
    })
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.editing) this.render()
    return true
  }

  private render(): void {
    this.dom.replaceChildren()
    const latex = stripWrappers((this.node.attrs.latex as string) ?? '', this.displayMode).trim()
    try {
      katex.render(latex, this.dom, {
        throwOnError: false,
        displayMode: this.displayMode,
        // KaTeX needs both HTML and MathML by default for `align*` and friends
        // to lay out their alignment columns correctly. Forcing 'html' alone
        // silently drops the intercolumn spacing on some envs.
        strict: false,
        macros: currentMathMacros
      })
      this.dom.style.color = ''
      this.dom.title = ''
    } catch (err) {
      this.dom.textContent = latex
      this.dom.style.color = 'var(--status-error)'
      this.dom.title = (err as Error).message
    }
  }

  private openEditor(): void {
    this.editing = true
    this.dom.replaceChildren()
    // Inline math uses an <input> with field-sizing:content so it grows
    // with the text and aligns to the surrounding baseline. Block math
    // keeps a textarea (multi-line LaTeX), but loses the resize grip and
    // browser-default chrome via CSS.
    const el = this.displayMode
      ? document.createElement('textarea')
      : document.createElement('input')
    el.className = this.displayMode ? 'math-block__editor' : 'math-inline__editor'
    el.value = this.node.attrs.latex as string
    el.spellcheck = false
    el.autocomplete = 'off'
    if (el instanceof HTMLInputElement) el.type = 'text'
    if (el instanceof HTMLTextAreaElement) {
      el.rows = Math.max(2, el.value.split('\n').length)
      // Auto-grow as the user types; field-sizing:content also handles
      // this in newer Chromium but rows-based fallback works everywhere.
      const autosize = (): void => {
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      }
      el.addEventListener('input', autosize)
      requestAnimationFrame(autosize)
    }
    this.editor = el
    this.dom.appendChild(el)
    requestAnimationFrame(() => {
      el.focus()
      // Place caret at end so the user is ready to extend the formula.
      try {
        const len = el.value.length
        if (el instanceof HTMLInputElement) el.setSelectionRange(len, len)
        else el.setSelectionRange(len, len)
      } catch {
        /* ignore */
      }
    })

    const commit = (): void => {
      const next = el.value
      this.editing = false
      const pos = this.getPos()
      if (typeof pos === 'number' && next !== this.node.attrs.latex) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          latex: next
        })
        this.view.dispatch(tr)
      } else {
        this.render()
      }
    }

    const cancel = (): void => {
      this.editing = false
      this.render()
    }

    // The union type narrows addEventListener to the generic `Event`
    // signature; cast through HTMLElement to recover KeyboardEvent typing.
    const elAsEl = el as HTMLElement
    elAsEl.addEventListener('blur', commit)
    elAsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        el.blur()
      } else if (e.key === 'Enter' && !this.displayMode) {
        e.preventDefault()
        el.blur()
      }
    })
  }

  selectNode(): void {
    if (!this.editing) this.openEditor()
  }

  deselectNode(): void {
    if (this.editing && this.editor) this.editor.blur()
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.editor = undefined
  }
}

// For block math the latex may be stored as a full delimited form. KaTeX
// understands `\begin{equation}...\end{equation}`, `\begin{align*}...`, and
// the other math envs natively in displayMode — DO NOT strip those, or
// KaTeX loses alignment context and chokes on bare `&=` / `\\`. Only
// strip `\[...\]` since KaTeX does NOT recognize those as delimiters.
function stripWrappers(latex: string, displayMode: boolean): string {
  if (!displayMode) return latex
  const dm = /^\s*\\\[([\s\S]*?)\\\]\s*$/.exec(latex)
  if (dm) return dm[1].trim()
  return latex
}

export const mathNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, false)

export const mathBlockNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, true)
