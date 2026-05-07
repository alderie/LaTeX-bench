import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'

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
    const latex = stripWrappers(this.node.attrs.latex as string, this.displayMode)
    try {
      katex.render(latex, this.dom, {
        throwOnError: false,
        displayMode: this.displayMode,
        output: 'html'
      })
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

// For block math the latex is stored as the full env text (e.g.
// `\begin{equation}…\end{equation}`); KaTeX wants the inner body, so strip
// the outer wrapper before rendering.
function stripWrappers(latex: string, displayMode: boolean): string {
  if (!displayMode) return latex
  const m = /^\s*\\begin\{([a-z*]+)\}([\s\S]*?)\\end\{\1\}\s*$/.exec(latex)
  if (m) return m[2].trim()
  const dm = /^\s*\\\[([\s\S]*?)\\\]\s*$/.exec(latex)
  if (dm) return dm[1].trim()
  return latex
}

export const mathNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, false)

export const mathBlockNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, true)
