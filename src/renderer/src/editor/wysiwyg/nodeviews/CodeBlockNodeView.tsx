import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { CodeField } from '../editors/code-field'
import { bindFinishKeys, EditorPanel, panelName, panelNote } from '../editors/editor-panel'

// `verbatim` / `lstlisting` / `minted` / … Rendered as a real code block
// rather than a raw-LaTeX blob that showed the `\begin{lstlisting}` and
// `\end{lstlisting}` delimiters to the reader. Click to edit the body in the
// same panel a formula or a table opens in; the environment name and its
// options are preserved untouched.
//
// The one thing this panel does differently is that its field is *not*
// coloured as LaTeX: the body of a listing is Python, and painting `\n` in it
// as a macro would be a confident lie about what the author wrote.
class CodeBlockView implements NodeView {
  dom: HTMLElement
  private editing = false
  private field: CodeField | null = null
  private finished = false

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
    this.editing = true
    this.finished = false
    this.dom.replaceChildren()
    this.dom.classList.add('code-block--editing')

    const panel = new EditorPanel({
      variant: 'code',
      onDelete: () => this.deleteSelf(),
      deleteTitle: 'Delete this listing'
    })
    panel.addControl(panelName(this.languageLabel()))

    const lines = panelNote('')
    panel.addControl(lines)
    const reflect = (): void => {
      const count = (this.field?.value ?? '').split('\n').length
      lines.textContent = `${count} line${count === 1 ? '' : 's'}`
    }

    this.field = new CodeField({
      value: this.node.attrs.code as string,
      multiline: true,
      highlight: false,
      className: 'code-field--code',
      onInput: reflect
    })
    reflect()
    panel.body.appendChild(this.field.dom)
    this.dom.appendChild(panel.dom)

    bindFinishKeys(panel, this.field.input, {
      commit: () => this.close(true),
      cancel: () => this.close(false),
      isFinished: () => this.finished,
      onDelete: () => this.deleteSelf(),
      // Tab indents rather than leaving the listing — this is code, and the
      // panel's own finish keys have no claim on it.
      intercept: (event) => {
        if (event.key !== 'Tab' || !this.field) return false
        event.preventDefault()
        const input = this.field.input
        const at = input.selectionStart ?? 0
        const end = input.selectionEnd ?? at
        this.field.value = `${input.value.slice(0, at)}    ${input.value.slice(end)}`
        this.field.setSelectionRange(at + 4, at + 4)
        return true
      }
    })

    requestAnimationFrame(() => {
      this.field?.refresh()
      this.field?.focus()
      this.field?.setSelectionRange(0, 0)
    })
  }

  private deleteSelf(): void {
    this.finished = true
    this.editing = false
    this.field = null
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
    this.view.focus()
  }

  private close(commit: boolean): void {
    if (this.finished) return
    this.finished = true
    const next = this.field?.value ?? (this.node.attrs.code as string)
    this.editing = false
    this.field = null
    this.dom.classList.remove('code-block--editing')
    const pos = this.getPos()
    if (commit && typeof pos === 'number' && next !== this.node.attrs.code) {
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, code: next })
      )
      return
    }
    this.render()
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
