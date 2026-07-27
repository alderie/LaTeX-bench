import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { attachAnchorNavigation } from '../anchor-nav'
import { formatNumberList } from '../ref-format'
import { getCitation, subscribe } from '../labelRegistry'

class CitationView implements NodeView {
  dom: HTMLElement
  private unsubscribe: () => void

  constructor(private node: PMNode) {
    this.dom = document.createElement('a')
    this.dom.className = 'citation'
    this.dom.contentEditable = 'false'
    // Resolved lazily: the target moves as the document is edited.
    attachAnchorNavigation(this.dom, () => this.dom.getAttribute('href')?.slice(1) ?? null)
    this.render()
    this.unsubscribe = subscribe(() => this.render())
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  private render(): void {
    const keys = (this.node.attrs.keys as string[]) ?? []
    const resolved = keys.map((k) => ({ key: k, ref: getCitation(k) }))

    if (keys.length === 0) {
      this.dom.classList.add('citation--unresolved')
      this.dom.removeAttribute('href')
      this.dom.textContent = '[?]'
      return
    }

    const allResolved = resolved.every((r) => r.ref !== undefined)
    this.dom.classList.toggle('citation--unresolved', !allResolved)

    // Anchor the link at the first resolvable key.
    const firstAnchor = resolved.find((r) => r.ref !== undefined)?.ref?.domAnchor
    if (firstAnchor) {
      ;(this.dom as HTMLAnchorElement).href = `#${firstAnchor}`
    } else {
      this.dom.removeAttribute('href')
    }

    // Tooltip lists the underlying keys for debugging.
    this.dom.title = keys.join(', ')

    if (!allResolved) {
      this.dom.textContent = `[${keys.join(', ')}]`
      return
    }

    // Numeric style (natbib's [numbers,sort&compress]): collapse a sorted
    // run of consecutive numbers into a range.
    const numbers = resolved
      .map((r) => r.ref!.number)
      .slice()
      .sort((a, b) => a - b)
    this.dom.textContent = `[${formatNumberList(numbers)}]`
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.unsubscribe()
  }
}

export const citationNodeView: NodeViewConstructor = (node) => new CitationView(node)
