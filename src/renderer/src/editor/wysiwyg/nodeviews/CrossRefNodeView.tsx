import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { attachAnchorNavigation } from '../anchor-nav'
import { getLabel, subscribe } from '../labelRegistry'
import { formatRefs } from '../ref-format'

class CrossRefView implements NodeView {
  dom: HTMLElement
  private unsubscribe: () => void

  constructor(private node: PMNode) {
    this.dom = document.createElement('a')
    this.dom.className = 'cross-ref'
    this.dom.contentEditable = 'false'
    // Resolved lazily: the target moves as the document is edited.
    attachAnchorNavigation(this.dom, () => this.dom.getAttribute('href')?.slice(1) ?? null)
    this.render()
    // Re-render whenever the registry rebuilds — section/theorem
    // numbering can shift around in response to edits elsewhere.
    this.unsubscribe = subscribe(() => this.render())
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  private render(): void {
    const cmd = (this.node.attrs.cmd as string) || 'ref'
    const keys = (this.node.attrs.keys as string[]) ?? []
    const fallbackKey = (this.node.attrs.label as string) || ''
    const effectiveKeys = keys.length > 0 ? keys : fallbackKey ? [fallbackKey] : []

    const resolved = effectiveKeys.map((k) => ({ key: k, ref: getLabel(k) }))
    const allResolved = resolved.every((r) => r.ref !== undefined)

    this.dom.classList.toggle('cross-ref--unresolved', !allResolved)
    // First (or only) anchor is what we link to. Multi-key cleveref
    // points to the first key — matches LaTeX's behaviour.
    const firstAnchor = resolved.find((r) => r.ref !== undefined)?.ref?.domAnchor
    if (firstAnchor) {
      ;(this.dom as HTMLAnchorElement).href = `#${firstAnchor}`
    } else {
      this.dom.removeAttribute('href')
    }
    this.dom.title = effectiveKeys.join(', ')

    this.dom.textContent = formatRefs(cmd, resolved)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.unsubscribe()
  }
}

export const crossRefNodeView: NodeViewConstructor = (node) => new CrossRefView(node)
