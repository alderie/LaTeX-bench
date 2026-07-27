import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { isAlgorithmSource, renderAlgorithm } from '../renderers/algorithm'
import { isTabularSource, renderTabular } from '../renderers/tabular'
import { isStructuralSource, renderStructural } from '../renderers/structural'

class RawLatexView implements NodeView {
  dom: HTMLElement
  private editing = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'raw-latex-block'
    this.dom.contentEditable = 'false'
    this.render()
    this.dom.addEventListener('click', () => {
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
    this.dom.classList.remove('raw-latex-block--rich')
    const source = (this.node.attrs.source as string) || ''
    if (!source) {
      this.dom.textContent = '% (empty raw block)'
      return
    }
    // `\appendix` and friends: understood, but not prose. A labelled rule
    // reads better than a box of source, and unlike the other rich
    // renderings there's nothing here worth opening an editor for.
    if (isStructuralSource(source)) {
      this.dom.classList.add('raw-latex-block--rich', 'raw-latex-block--structural')
      this.dom.appendChild(renderStructural(source))
      return
    }
    if (isTabularSource(source)) {
      this.dom.classList.add('raw-latex-block--rich')
      this.dom.appendChild(renderTabular(source))
      return
    }
    if (isAlgorithmSource(source)) {
      this.dom.classList.add('raw-latex-block--rich')
      this.dom.appendChild(renderAlgorithm(source))
      return
    }
    // Plain raw-LaTeX fallback — preserve the pre-formatted whitespace
    // look by setting `white-space: pre-wrap` on `.raw-latex-block` (CSS).
    this.dom.textContent = source
  }

  private openEditor(): void {
    const measuredHeight = this.dom.getBoundingClientRect().height
    this.editing = true
    this.dom.replaceChildren()
    this.dom.classList.remove('raw-latex-block--rich')
    this.dom.classList.add('raw-latex-block--editing')
    const ta = document.createElement('textarea')
    ta.className = 'raw-latex-block__editor'
    ta.value = this.node.attrs.source as string
    ta.style.height = `${measuredHeight}px`
    this.dom.appendChild(ta)

    const autoSize = (): void => {
      ta.style.height = '0px'
      ta.style.height = `${ta.scrollHeight}px`
    }
    // Two rAFs: first lets the browser apply CSS, second measures correctly.
    requestAnimationFrame(() => {
      autoSize()
      requestAnimationFrame(() => {
        autoSize()
        ta.focus()
        ta.setSelectionRange(0, 0)
        ta.scrollTop = 0
      })
    })
    ta.addEventListener('input', autoSize)

    const commit = (): void => {
      const next = ta.value
      this.editing = false
      this.dom.classList.remove('raw-latex-block--editing')
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

    ta.addEventListener('blur', commit)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ta.blur()
      }
    })
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    /* no-op */
  }
}

export const rawLatexNodeView: NodeViewConstructor = (node, view, getPos) =>
  new RawLatexView(node, view, getPos)
