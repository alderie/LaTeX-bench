import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { getEquationNumbersForPos, subscribe as subscribeRegistry } from '../labelRegistry'
import { getMathMacros, injectEquationTags, stripMathWrappers } from '../math-macros'

// Re-exported for the editor, which sets the table when a paper loads.
export { setMathMacros, getMathMacros } from '../math-macros'

class MathView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement
  private editing = false
  private editor?: HTMLInputElement | HTMLTextAreaElement
  private unsubscribe: (() => void) | null = null

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

    // Display-mode math is the only kind we renumber. Re-render when
    // the registry's per-position equation numbers change.
    if (this.displayMode) {
      this.unsubscribe = subscribeRegistry(() => {
        if (!this.editing) this.render()
      })
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.editing) this.render()
    return true
  }

  private render(): void {
    this.dom.replaceChildren()
    const rawLatex = (this.node.attrs.latex as string) ?? ''
    let latex = stripWrappers(rawLatex, this.displayMode).trim()
    if (this.displayMode) {
      const pos = this.getPos()
      latex = injectEquationTags(
        latex,
        typeof pos === 'number' ? getEquationNumbersForPos(pos) : undefined
      )
    }
    // Set anchor id so cleveref-style cross-refs can scroll into view.
    if (this.displayMode) {
      const primaryLabel = this.node.attrs.label as string | null
      if (primaryLabel) {
        this.dom.id = `latex-anchor-${primaryLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      } else {
        this.dom.removeAttribute('id')
      }
    }
    try {
      katex.render(latex, this.dom, {
        throwOnError: false,
        displayMode: this.displayMode,
        // KaTeX needs both HTML and MathML by default for `align*` and friends
        // to lay out their alignment columns correctly. Forcing 'html' alone
        // silently drops the intercolumn spacing on some envs.
        strict: false,
        macros: getMathMacros()
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

    // Live preview. Editing a formula blind — type LaTeX, blur, look, fix,
    // re-open — is the slowest loop in the editor. Rendering as the author
    // types collapses it to one pass. Block math gets the preview; inline
    // math is small enough that the surrounding line is the preview.
    let preview: HTMLElement | null = null
    if (this.displayMode) {
      preview = document.createElement('div')
      preview.className = 'math-preview'
      this.dom.appendChild(preview)
      const paint = (): void => {
        if (!preview) return
        const source = stripMathWrappers(el.value).trim()
        preview.classList.remove('math-preview--error')
        if (source === '') {
          preview.textContent = ''
          return
        }
        try {
          katex.render(source, preview, {
            throwOnError: true,
            displayMode: true,
            strict: false,
            macros: getMathMacros()
          })
        } catch (err) {
          // KaTeX's message names the offending token, which is exactly
          // what an author needs mid-formula.
          preview.classList.add('math-preview--error')
          preview.textContent = (err as Error).message
        }
      }
      // Coalesce to one render per frame: KaTeX on a large `align` is
      // expensive enough that per-keystroke rendering stutters.
      let queued = false
      const schedulePaint = (): void => {
        if (queued) return
        queued = true
        requestAnimationFrame(() => {
          queued = false
          paint()
        })
      }
      el.addEventListener('input', schedulePaint)
      paint()
    }
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
      preview?.remove()
      preview = null
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
      preview?.remove()
      preview = null
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
      } else if (e.key === 'Tab' && this.displayMode) {
        // Inside a matrix or align body, Tab means "next cell". Leaving the
        // field is what a browser does by default and is never what the
        // author wants here — the surrounding editor is one keystroke away
        // via Escape.
        e.preventDefault()
        insertAtCursor(el as HTMLTextAreaElement, e.shiftKey ? ' \\\\\n  ' : ' & ')
        el.dispatchEvent(new Event('input'))
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
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}

// Splice text at the caret of a textarea. Used by the Tab handler to move
// between matrix / align cells.
function insertAtCursor(el: HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  el.value = el.value.slice(0, start) + text + el.value.slice(end)
  const caret = start + text.length
  el.setSelectionRange(caret, caret)
}

function stripWrappers(latex: string, displayMode: boolean): string {
  return displayMode ? stripMathWrappers(latex) : latex
}

export const mathNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, false)

export const mathBlockNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, true)
