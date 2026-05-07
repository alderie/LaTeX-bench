import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'

// The preamble (everything before \begin{document}) is shown collapsed by
// default — it's structural rather than authorial. Click to reveal a small
// CodeMirror-less textarea editor.

class PreambleView implements NodeView {
  dom: HTMLElement
  private expanded = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'preamble-block'
    this.dom.contentEditable = 'false'
    this.render()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.expanded) this.render()
    return true
  }

  private render(): void {
    this.dom.replaceChildren()
    const header = document.createElement('button')
    header.type = 'button'
    header.className = 'preamble-block__header'
    const lineCount = (this.node.attrs.source as string).split('\n').length
    header.textContent = `Preamble · ${lineCount} line${lineCount === 1 ? '' : 's'} (click to edit)`
    header.addEventListener('click', () => this.toggle())
    this.dom.appendChild(header)
    if (this.expanded) {
      const ta = document.createElement('textarea')
      ta.className = 'preamble-block__editor'
      ta.value = this.node.attrs.source as string
      ta.rows = Math.max(4, lineCount + 1)
      ta.addEventListener('blur', () => this.commit(ta.value))
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          ta.blur()
        }
      })
      this.dom.appendChild(ta)
      requestAnimationFrame(() => ta.focus())
    }
  }

  private toggle(): void {
    this.expanded = !this.expanded
    this.render()
  }

  private commit(next: string): void {
    this.expanded = false
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

  stopEvent(): boolean {
    return this.expanded
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    /* no-op */
  }
}

export const preambleNodeView: NodeViewConstructor = (node, view, getPos) =>
  new PreambleView(node, view, getPos)
