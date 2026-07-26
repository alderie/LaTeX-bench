import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { useLibraryStore } from '../../../stores/libraryStore'
import { getLabel, subscribe } from '../labelRegistry'

class FigureView implements NodeView {
  dom: HTMLElement
  private unsubscribe: () => void

  constructor(private node: PMNode) {
    this.dom = document.createElement('figure')
    this.dom.className = 'figure-block'
    this.dom.contentEditable = 'false'
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
    const src = (this.node.attrs.src as string).trim()
    const caption = (this.node.attrs.caption as string).trim()
    const label = (this.node.attrs.label as string | null) || null
    this.dom.replaceChildren()

    if (label) {
      this.dom.id = `latex-anchor-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    } else {
      this.dom.removeAttribute('id')
    }

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

    if (caption || label) {
      const cap = document.createElement('figcaption')
      cap.className = 'figure-block__caption'
      const resolved = label ? getLabel(label) : undefined
      const number = resolved?.number ?? ''
      const tag = document.createElement('span')
      tag.className = 'figure-block__tag'
      tag.textContent = number ? `Figure ${number}` : 'Figure'
      cap.appendChild(tag)
      if (caption) {
        cap.appendChild(document.createTextNode(' · '))
        cap.appendChild(document.createTextNode(caption))
      }
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
    this.unsubscribe()
  }
}

export const figureNodeView: NodeViewConstructor = (node) => new FigureView(node)
