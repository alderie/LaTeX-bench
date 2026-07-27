import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { isAlgorithmSource, renderAlgorithm } from '../renderers/algorithm'
import { isTabularSource, renderTabular } from '../renderers/tabular'
import { isStructuralSource, renderStructural } from '../renderers/structural'
import { SourceBlockEditor } from '../editors/source-block-editor'
import { TabularEditor } from '../editors/tabular-editor'
import { CELL_ATTRIBUTE } from '../editors/cell-editor'
import { settle } from './settle'

// A block the parser kept as source. Three of those turn out to be things we
// can draw — a table, an algorithm, a `\appendix` rule — and the rest are
// shown as the LaTeX they are.
//
// Editing goes through the same panel the formula editor uses, so a table
// clicked open looks like an equation clicked open: a bar naming what this is
// and what can be changed about it, a highlighted source area, and a live
// rendering underneath. A table gets the table editor, which adds the
// controls only a table has (its column spec, its shape); everything else
// gets the plain source editor.

class RawLatexView implements NodeView {
  dom: HTMLElement
  private editing = false
  private editor: TabularEditor | SourceBlockEditor | null = null
  /** The next render is the one that follows an edit, so it arrives. */
  private settling = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'raw-latex-block'
    this.dom.contentEditable = 'false'
    this.render()
    this.dom.addEventListener('click', (event) => {
      if (this.editing) return
      // A click on a table cell opens that cell, not the top of the source:
      // the rendering carries the offsets it was drawn from either way, so
      // the cell under the pointer is known before the editor exists.
      const cell = (event.target as HTMLElement | null)?.closest(`[${CELL_ATTRIBUTE}]`)
      this.openEditor(cell ? Number(cell.getAttribute(CELL_ATTRIBUTE)) : null)
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
    this.dom.classList.remove('raw-latex-block--rich', 'raw-latex-block--editing')
    if (this.settling) {
      this.settling = false
      settle(this.dom)
    }
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

  private openEditor(cellFrom: number | null = null): void {
    const source = (this.node.attrs.source as string) || ''
    // Structural markers have nothing to edit — see `render`.
    if (isStructuralSource(source)) return

    this.editing = true
    this.dom.replaceChildren()
    this.dom.classList.remove('raw-latex-block--rich')
    this.dom.classList.add('raw-latex-block--editing')

    const handlers = {
      onCommit: (next: string) => this.closeEditor(next),
      onCancel: () => this.closeEditor(null),
      onDelete: () => this.deleteSelf()
    }
    this.editor = isTabularSource(source)
      ? new TabularEditor({ source, ...handlers })
      : new SourceBlockEditor({
          source,
          variant: 'raw',
          title: environmentName(source) ?? 'LaTeX',
          deleteTitle: 'Delete this block',
          ...handlers
        })
    this.dom.appendChild(this.editor.dom)
    const editor = this.editor
    if (editor instanceof TabularEditor && cellFrom !== null && editor.openCell(cellFrom)) return
    editor.focus()
  }

  /** Leave editing mode, writing `source` back when it changed. */
  private closeEditor(source: string | null): void {
    this.editing = false
    this.settling = true
    this.editor?.destroy()
    this.editor = null
    this.dom.classList.remove('raw-latex-block--editing')

    const pos = this.getPos()
    if (source !== null && typeof pos === 'number' && source !== this.node.attrs.source) {
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, source })
      )
      return
    }
    this.render()
  }

  private deleteSelf(): void {
    this.editing = false
    this.editor?.destroy()
    this.editor = null
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
    this.view.focus()
  }

  // Selecting the node counts as asking to edit it, the same way it does for
  // a formula — that's what lets an insert drop the caret straight into the
  // table it just made.
  selectNode(): void {
    if (!this.editing) this.openEditor()
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.editor?.destroy()
    this.editor = null
  }
}

/** `\begin{foo}` → `foo`, for a bar that says what this block is. */
function environmentName(source: string): string | null {
  return /^\s*\\begin\{([A-Za-z@]+\*?)\}/.exec(source)?.[1] ?? null
}

export const rawLatexNodeView: NodeViewConstructor = (node, view, getPos) =>
  new RawLatexView(node, view, getPos)
