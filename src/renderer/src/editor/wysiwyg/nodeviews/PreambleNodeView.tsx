import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { SourceBlockEditor } from '../editors/source-block-editor'
import { createIcon } from '../icons'

// The preamble (everything before \begin{document}) is shown collapsed by
// default — it's structural rather than authorial. Clicking it opens the same
// panel a formula or a table opens in, with the LaTeX highlighted: sixty
// lines of `\usepackage`, `\newcommand` and commented-out experiments is
// exactly the kind of text that is unreadable as one grey wall, and it was
// the last surface in the paper still showing it that way.

class PreambleView implements NodeView {
  dom: HTMLElement
  private expanded = false
  private editor: SourceBlockEditor | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'preamble-block'
    this.dom.contentEditable = 'false'
    this.render()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.expanded) this.render()
    return true
  }

  private render(): void {
    this.editor?.destroy()
    this.editor = null
    this.dom.replaceChildren()
    this.dom.classList.toggle('preamble-block--open', this.expanded)

    if (this.expanded) {
      this.editor = new SourceBlockEditor({
        source: this.node.attrs.source as string,
        variant: 'preamble',
        title: 'Preamble',
        onCommit: (next) => this.commit(next),
        onCancel: () => this.collapse()
      })
      this.dom.appendChild(this.editor.dom)
      this.editor.focus()
      return
    }

    const header = document.createElement('button')
    header.type = 'button'
    header.className = 'preamble-block__header'
    header.appendChild(createIcon('braces', 13))

    const label = document.createElement('span')
    label.className = 'preamble-block__title'
    label.textContent = 'Preamble'
    header.appendChild(label)

    const source = this.node.attrs.source as string
    const lineCount = source.split('\n').length
    const meta = document.createElement('span')
    meta.className = 'preamble-block__meta'
    meta.textContent = summarize(source, lineCount)
    header.appendChild(meta)

    const hint = document.createElement('span')
    hint.className = 'preamble-block__hint'
    hint.textContent = 'click to edit'
    header.appendChild(hint)

    header.addEventListener('click', () => this.toggle())
    this.dom.appendChild(header)
  }

  private toggle(): void {
    this.expanded = !this.expanded
    this.render()
  }

  private collapse(): void {
    this.expanded = false
    this.render()
  }

  private commit(next: string): void {
    this.expanded = false
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

  stopEvent(): boolean {
    return this.expanded
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.editor?.destroy()
    this.editor = null
  }
}

/**
 * What the collapsed row says about what it is hiding.
 *
 * A line count alone answers "how much of this is there", which is the less
 * useful of the two questions — the other being "what does this document
 * load", and the packages are the answer to that.
 */
function summarize(source: string, lineCount: number): string {
  const packages = [...source.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)]
    .flatMap((match) => match[1].split(',').map((name) => name.trim()))
    .filter(Boolean)
  const lines = `${lineCount} line${lineCount === 1 ? '' : 's'}`
  if (packages.length === 0) return lines
  return `${lines} · ${packages.length} package${packages.length === 1 ? '' : 's'}`
}

export const preambleNodeView: NodeViewConstructor = (node, view, getPos) =>
  new PreambleView(node, view, getPos)
