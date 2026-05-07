import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'

class CitationView implements NodeView {
  dom: HTMLElement
  constructor(private node: PMNode) {
    this.dom = document.createElement('span')
    this.dom.className = 'citation-chip'
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
    const keys = (this.node.attrs.keys as string[]) ?? []
    this.dom.textContent = keys.length === 0 ? '[?]' : `[${keys.join(', ')}]`
  }

  ignoreMutation(): boolean {
    return true
  }
}

export const citationNodeView: NodeViewConstructor = (node) => new CitationView(node)
