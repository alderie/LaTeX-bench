import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'

class RawLatexView implements NodeView {
  dom: HTMLElement
  private editing = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('pre')
    this.dom.className = 'raw-latex-block'
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

  private render(): void {
    this.dom.textContent = (this.node.attrs.source as string) || '% (empty raw block)'
  }

  private openEditor(): void {
    this.editing = true
    this.dom.replaceChildren()
    const ta = document.createElement('textarea')
    ta.className = 'raw-latex-block__editor'
    ta.value = this.node.attrs.source as string
    ta.rows = Math.max(3, ta.value.split('\n').length)
    this.dom.appendChild(ta)
    requestAnimationFrame(() => ta.focus())

    const commit = (): void => {
      const next = ta.value
      this.editing = false
      const pos = this.getPos()
      if (typeof pos === 'number' && next !== this.node.attrs.source) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          source: next
        })
        this.view.dispatch(tr)
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
    })
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    /* no-op */
  }
}

export const rawLatexNodeView: NodeViewConstructor = (node, view, getPos) =>
  new RawLatexView(node, view, getPos)
