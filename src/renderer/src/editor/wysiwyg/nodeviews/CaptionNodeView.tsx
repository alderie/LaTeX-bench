import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { getFloatNumberForPos, subscribe } from '../labelRegistry'

// `\caption{…}` inside a float. LaTeX prints it as "Table 1: <text>", so
// the number is rendered here as a non-editable prefix. The number comes
// from the label registry keyed by the *parent* float's position, which is
// why this lives on the caption rather than being stamped onto the caption
// from the float — ProseMirror re-renders child DOM and would wipe an
// externally-set attribute.
class CaptionView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private prefix: HTMLElement
  private unsubscribe: () => void

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    void node
    this.dom = document.createElement('figcaption')
    this.dom.className = 'float-block__caption'
    this.prefix = document.createElement('span')
    this.prefix.className = 'float-block__caption-prefix'
    this.prefix.contentEditable = 'false'
    this.contentDOM = document.createElement('span')
    this.contentDOM.className = 'float-block__caption-text'
    this.dom.append(this.prefix, this.contentDOM)
    this.renderPrefix()
    this.unsubscribe = subscribe(() => this.renderPrefix())
  }

  update(): boolean {
    this.renderPrefix()
    return true
  }

  private renderPrefix(): void {
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    let num: ReturnType<typeof getFloatNumberForPos>
    try {
      // The caption's parent is the float; `$pos.before()` is where the
      // registry filed the float's number.
      const $pos = this.view.state.doc.resolve(pos)
      num = getFloatNumberForPos($pos.before())
    } catch {
      num = undefined
    }
    this.prefix.textContent = num ? `${num.kindLabel} ${num.number}: ` : ''
    this.dom.classList.toggle('float-block__caption--numbered', Boolean(num))
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    // The prefix is ours, not ProseMirror's content.
    return this.prefix.contains(mutation.target)
  }

  destroy(): void {
    this.unsubscribe()
  }
}

export const captionNodeView: NodeViewConstructor = (node, view, getPos) =>
  new CaptionView(node, view, getPos as () => number | undefined)
