import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { renderInlineLatex } from '../renderers/inline-render'

// `\footnote{…}` / `\thanks{…}` render as a superscript marker. The number
// comes from a CSS counter so it stays right as footnotes are added and
// removed; clicking the marker opens the note body for editing.
//
// Before this existed the note body was flattened into the surrounding
// prose — which is why the title block read "Alex M. ReyesCorresponding
// author: reyes@example.edu."
class FootnoteView implements NodeView {
  dom: HTMLElement
  private editing = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('sup')
    this.dom.className = 'footnote-marker'
    this.dom.contentEditable = 'false'
    this.render()
    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
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
    this.dom.replaceChildren()
    this.dom.classList.remove('footnote-marker--editing')
    const source = (this.node.attrs.source as string) || ''
    this.dom.dataset.cmd = (this.node.attrs.cmd as string) || 'footnote'
    // Plain-text preview for the native tooltip; the popover below shows
    // the same text with math and styling rendered.
    this.dom.title = source

    const popover = document.createElement('span')
    popover.className = 'footnote-marker__note'
    popover.appendChild(renderInlineLatex(source))
    this.dom.appendChild(popover)
  }

  private openEditor(): void {
    this.editing = true
    this.dom.classList.add('footnote-marker--editing')
    this.dom.replaceChildren()
    const input = document.createElement('textarea')
    input.className = 'footnote-marker__editor'
    input.value = this.node.attrs.source as string
    this.dom.appendChild(input)
    input.focus()
    input.select()

    const commit = (): void => {
      const next = input.value
      this.editing = false
      const pos = this.getPos()
      if (typeof pos === 'number' && next !== this.node.attrs.source) {
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, source: next })
        )
      } else {
        this.render()
      }
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        input.blur()
      }
    })
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }
}

export const footnoteNodeView: NodeViewConstructor = (node, view, getPos) =>
  new FootnoteView(node, view, getPos as () => number | undefined)
