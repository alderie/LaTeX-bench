import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { getEquationNumbersForPos, subscribe as subscribeRegistry } from '../labelRegistry'
import { getMathMacros, injectEquationTags, stripMathWrappers } from '../math-macros'
import { FormulaEditor } from './formula-editor'

// Re-exported for the editor, which sets the table when a paper loads.
export { setMathMacros, getMathMacros } from '../math-macros'

class MathView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement
  private editing = false
  private editor: FormulaEditor | null = null
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
    this.dom.classList.add(this.displayMode ? 'math-block--editing' : 'math-inline--editing')

    const editor = new FormulaEditor({
      latex: this.node.attrs.latex as string,
      displayMode: this.displayMode,
      onCommit: (latex) => this.closeEditor(latex),
      onCancel: () => this.closeEditor(null)
    })
    this.editor = editor
    this.dom.appendChild(editor.dom)
    editor.focus()
  }

  /** Leave editing mode, writing `latex` back to the node when it changed. */
  private closeEditor(latex: string | null): void {
    this.editing = false
    this.editor?.destroy()
    this.editor = null
    this.dom.classList.remove('math-block--editing', 'math-inline--editing')

    const pos = this.getPos()

    // An inline formula with no source renders to nothing — a zero-width node
    // the author can neither see nor click, but which still has to be
    // arrowed past. Emptying one is how you say "never mind", and so is
    // escaping straight out of the empty one `/inline math` just inserted,
    // which is why the cancel path (`latex === null`) is checked too.
    const resulting = latex ?? ((this.node.attrs.latex as string) ?? '')
    if (!this.displayMode && resulting.trim() === '' && typeof pos === 'number') {
      this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
      this.view.focus()
      return
    }

    if (latex !== null && typeof pos === 'number' && latex !== this.node.attrs.latex) {
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex })
      )
      return
    }
    this.render()
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
    this.editor?.destroy()
    this.editor = null
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}

function stripWrappers(latex: string, displayMode: boolean): string {
  return displayMode ? stripMathWrappers(latex) : latex
}

export const mathNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, false)

export const mathBlockNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, true)
