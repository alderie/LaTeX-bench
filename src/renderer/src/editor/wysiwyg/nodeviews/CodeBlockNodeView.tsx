import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'

// `verbatim` / `lstlisting` / `minted` / … Rendered as a real code block
// rather than a raw-LaTeX blob that showed the `\begin{lstlisting}` and
// `\end{lstlisting}` delimiters to the reader. Click to edit the body;
// the environment name and its options are preserved untouched.
class CodeBlockView implements NodeView {
  dom: HTMLElement
  private editing = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'code-block'
    this.dom.contentEditable = 'false'
    this.render()
    this.dom.addEventListener('click', () => {
      if (!this.editing) this.openEditor()
    })
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.editing) this.render()
    return true
  }

  private languageLabel(): string {
    const language = (this.node.attrs.language as string) || ''
    if (language) return language
    const env = (this.node.attrs.env as string) || 'verbatim'
    return env === 'verbatim' ? 'verbatim' : env
  }

  private render(): void {
    this.dom.replaceChildren()
    this.dom.classList.remove('code-block--editing')

    const chip = document.createElement('span')
    chip.className = 'code-block__lang'
    chip.textContent = this.languageLabel()
    this.dom.appendChild(chip)

    const pre = document.createElement('pre')
    pre.className = 'code-block__body'
    pre.textContent = (this.node.attrs.code as string) || ''
    this.dom.appendChild(pre)
  }

  private openEditor(): void {
    const height = this.dom.getBoundingClientRect().height
    this.editing = true
    this.dom.replaceChildren()
    this.dom.classList.add('code-block--editing')

    const ta = document.createElement('textarea')
    ta.className = 'code-block__editor'
    ta.value = this.node.attrs.code as string
    ta.style.height = `${height}px`
    this.dom.appendChild(ta)

    const autoSize = (): void => {
      ta.style.height = '0px'
      ta.style.height = `${ta.scrollHeight}px`
    }
    requestAnimationFrame(() => {
      autoSize()
      ta.focus()
      ta.setSelectionRange(0, 0)
    })
    ta.addEventListener('input', autoSize)

    const commit = (): void => {
      const next = ta.value
      this.editing = false
      this.dom.classList.remove('code-block--editing')
      const pos = this.getPos()
      if (typeof pos === 'number' && next !== this.node.attrs.code) {
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, code: next })
        )
      } else {
        this.render()
      }
    }
    ta.addEventListener('blur', commit)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ta.blur()
      }
      // Tab inserts an indent instead of leaving the block.
      if (e.key === 'Tab') {
        e.preventDefault()
        const { selectionStart: s, selectionEnd: eSel } = ta
        ta.value = `${ta.value.slice(0, s)}    ${ta.value.slice(eSel)}`
        ta.selectionStart = ta.selectionEnd = s + 4
      }
    })
  }

  // Selecting the node counts as asking to edit it — that's what lets the
  // slash menu drop the caret straight into a freshly inserted code block
  // instead of leaving it parked next to one.
  selectNode(): void {
    if (!this.editing) this.openEditor()
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }
}

export const codeBlockNodeView: NodeViewConstructor = (node, view, getPos) =>
  new CodeBlockView(node, view, getPos as () => number | undefined)
