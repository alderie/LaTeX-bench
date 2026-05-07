import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { useLibraryStore } from '../../../stores/libraryStore'

class FigureView implements NodeView {
  dom: HTMLElement

  constructor(private node: PMNode) {
    this.dom = document.createElement('figure')
    this.dom.className = 'figure-block'
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
    const src = (this.node.attrs.src as string).trim()
    const caption = (this.node.attrs.caption as string).trim()
    this.dom.replaceChildren()

    const img = document.createElement('img')
    img.alt = caption || 'figure'
    img.className = 'figure-block__image'
    if (src) {
      const paperId = useLibraryStore.getState().selectedPaperId
      img.src = paperId ? `paper://${paperId}/assets/${src}` : src
    } else {
      img.classList.add('figure-block__image--empty')
    }
    this.dom.appendChild(img)

    if (caption) {
      const cap = document.createElement('figcaption')
      cap.className = 'figure-block__caption'
      cap.textContent = caption
      this.dom.appendChild(cap)
    }
  }

  ignoreMutation(): boolean {
    return true
  }

  stopEvent(): boolean {
    return false
  }

  destroy(): void {
    /* no-op */
  }
}

export const figureNodeView: NodeViewConstructor = (node) => new FigureView(node)
