import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { getLabel, subscribe } from '../labelRegistry'

// Node view for theorem-like environments. The body is fully editable
// via `contentDOM` — we render the same `<aside data-theorem>` shell as
// the schema's toDOM, but additionally sync a `data-number` attribute
// from the label registry so the kind label can read "Theorem 3.1"
// rather than just "Theorem". Subscribes to the registry so renumbering
// elsewhere in the doc (e.g. inserting a new lemma earlier) updates the
// label live.
class TheoremView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private unsubscribe: () => void

  constructor(private node: PMNode) {
    const aside = document.createElement('aside')
    this.dom = aside
    this.contentDOM = aside
    this.applyAttrs()
    this.unsubscribe = subscribe(() => this.applyAttrs())
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.applyAttrs()
    return true
  }

  private applyAttrs(): void {
    const kind = (this.node.attrs.kind as string) || 'theorem'
    const label = (this.node.attrs.label as string | null) || null
    const title = (this.node.attrs.title as string | null) || null
    this.dom.setAttribute('data-theorem', '')
    this.dom.setAttribute('data-kind', kind)
    if (title) this.dom.setAttribute('data-title', title)
    else this.dom.removeAttribute('data-title')
    if (label) {
      this.dom.setAttribute('data-label', label)
      this.dom.id = `latex-anchor-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      const resolved = getLabel(label)
      if (resolved && resolved.number) {
        this.dom.setAttribute('data-number', resolved.number)
      } else {
        this.dom.removeAttribute('data-number')
      }
    } else {
      this.dom.removeAttribute('data-label')
      this.dom.removeAttribute('id')
      this.dom.removeAttribute('data-number')
    }
  }

  ignoreMutation(): boolean {
    // Don't block content edits — only ignore changes outside contentDOM.
    return false
  }

  destroy(): void {
    this.unsubscribe()
  }
}

export const theoremNodeView: NodeViewConstructor = (node) => new TheoremView(node)
