import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'

class CrossRefView implements NodeView {
  dom: HTMLElement
  constructor(private node: PMNode) {
    this.dom = document.createElement('span')
    this.dom.className = 'cross-ref-chip'
    this.dom.contentEditable = 'false'
    this.render()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  private render(): void {
    const label = (this.node.attrs.label as string) || '?'
    this.dom.textContent = `→ ${label}`
  }

  ignoreMutation(): boolean {
    return true
  }
}

export const crossRefNodeView: NodeViewConstructor = (node) => new CrossRefView(node)
