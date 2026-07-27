// Deleting a block.
//
// Structural blocks — a theorem, a display equation, a figure, a code
// listing — are node views with their own chrome, and until now there was no
// way to get rid of one. Backspace at the top of a theorem's body did nothing
// (the base keymap's `joinBackward` won't cross a `defining` boundary), an
// empty display equation renders to nothing at all and so couldn't even be
// aimed at, and none of them had a control that said "remove this".
//
// Two ways in, because they answer different questions:
//
//   - Backspace/Delete in an empty block. This is the reflex — you emptied
//     it, one more press should take the container with it.
//   - A delete button that appears in the margin beside whichever block the
//     pointer is over, for blocks that aren't empty and that you'd otherwise
//     have to select by hand.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Selection, Plugin } from 'prosemirror-state'
import type { Command, EditorState, Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { createIcon } from './icons'

/**
 * Blocks a delete can take out whole.
 *
 * Deliberately not everything: `section`, `preamble`, `titleBlock` and
 * `bibliography` are the document's skeleton, and "delete" on one of those
 * means "delete everything under it" — a different, much more destructive
 * operation than the one being offered here.
 */
export const DELETABLE_BLOCKS = new Set([
  'mathBlock',
  'figure',
  'figureImage',
  'floatBlock',
  'codeBlock',
  'rawLatex',
  'listBlock',
  'theoremEnv'
])

/** Blocks whose content lives in an attribute rather than in child nodes. */
const EMPTY_BY_ATTR: Record<string, (node: PMNode) => boolean> = {
  mathBlock: (n) => isBlankMath(n.attrs.latex as string),
  rawLatex: (n) => ((n.attrs.source as string) ?? '').trim() === '',
  codeBlock: (n) => ((n.attrs.code as string) ?? '').trim() === '',
  figure: (n) => ((n.attrs.src as string) ?? '').trim() === '',
  figureImage: (n) => ((n.attrs.src as string) ?? '').trim() === ''
}

/**
 * An equation whose source is only its wrapper — `\[ \]`, `$$ $$`, or an
 * environment with nothing between `\begin` and `\end`. It renders to nothing,
 * so as far as the author is concerned the block is empty.
 */
function isBlankMath(latex: string): boolean {
  const body = (latex ?? '')
    .trim()
    .replace(/^\\\[|\\\]$/g, '')
    .replace(/^\$\$|\$\$$/g, '')
    .replace(/^\\begin\{[a-zA-Z]+\*?\}|\\end\{[a-zA-Z]+\*?\}$/g, '')
  return body.trim() === ''
}

/** Nothing an author put there is left in this node. */
export function isEmptyBlock(node: PMNode): boolean {
  const byAttr = EMPTY_BY_ATTR[node.type.name]
  if (byAttr) return byAttr(node)
  // A leaf with no attribute rule carries its own meaning (a hard break, an
  // image, an inline citation) — its presence is content.
  if (node.isLeaf || node.isAtom) return node.isText ? (node.text ?? '').trim() === '' : false
  let empty = true
  node.forEach((child) => {
    if (!isEmptyBlock(child)) empty = false
  })
  return empty
}

/** Delete the node at `pos`, leaving the caret where it used to be. */
export function deleteBlockAt(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (!node) return null
  const tr = state.tr.delete(pos, pos + node.nodeSize)
  // `delete` is a no-op when the result wouldn't fit the schema — say the
  // block is the only child of a container that requires one.
  if (!tr.docChanged) return null
  const near = Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1)
  return tr.setSelection(near).scrollIntoView()
}

/**
 * The block a delete keypress should take, or null to let the base keymap
 * have the key.
 *
 * `dir` is which side of the caret the key reaches for: Backspace looks
 * behind it, Delete ahead. Both also act on a whole block that is selected
 * outright, which is what clicking a figure or an equation gives you.
 */
function blockToDelete(state: EditorState, dir: -1 | 1): number | null {
  const { selection } = state
  if (selection instanceof NodeSelection) {
    return DELETABLE_BLOCKS.has(selection.node.type.name) ? selection.from : null
  }
  if (!selection.empty) return null
  const $cursor = selection.$from
  // The caret is in something empty: hand the key to the innermost block
  // around it that is *also* empty. Stopping at the innermost non-empty
  // ancestor is what keeps "backspace in the empty paragraph of a written
  // theorem" from deleting the theorem.
  if ($cursor.parent.content.size === 0) {
    for (let depth = $cursor.depth; depth > 0; depth--) {
      const node = $cursor.node(depth)
      if (!isEmptyBlock(node)) break
      if (DELETABLE_BLOCKS.has(node.type.name)) return $cursor.before(depth)
    }
  }
  // Or the caret is at the edge of a paragraph and the block on the other
  // side is an empty one — an equation with no source renders to nothing, so
  // this is the only way to aim at it at all.
  const atEdge =
    dir === -1 ? $cursor.parentOffset === 0 : $cursor.parentOffset === $cursor.parent.content.size
  if (!atEdge || $cursor.depth === 0) return null
  const parentPos = $cursor.before($cursor.depth)
  const $block = state.doc.resolve(parentPos)
  const sibling =
    dir === -1
      ? $block.nodeBefore
      : state.doc.resolve(parentPos + $cursor.parent.nodeSize).nodeAfter
  if (!sibling || !DELETABLE_BLOCKS.has(sibling.type.name) || !isEmptyBlock(sibling)) return null
  return dir === -1 ? parentPos - sibling.nodeSize : parentPos + $cursor.parent.nodeSize
}

function deleteBlockCommand(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const pos = blockToDelete(state, dir)
    if (pos === null) return false
    const tr = deleteBlockAt(state, pos)
    if (!tr) return false
    dispatch?.(tr)
    return true
  }
}

export const deleteBlockBackward = deleteBlockCommand(-1)
export const deleteBlockForward = deleteBlockCommand(1)

export const blockDeleteKeymap = {
  Backspace: deleteBlockBackward,
  Delete: deleteBlockForward
}

// ── The margin handle ──────────────────────────────────────────────────────

interface Target {
  pos: number
  typeName: string
}

/**
 * A delete button that follows the pointer down the margin, aimed at whatever
 * block it is beside.
 *
 * It lives outside `.ProseMirror` — a sibling in the scrolling host — so it is
 * not part of the document ProseMirror manages, and it is positioned in the
 * host's coordinates rather than the viewport's so it scrolls with the block
 * it belongs to instead of sliding across it.
 */
export function blockHandle(): Plugin {
  return new Plugin({
    view: (view) => new BlockHandleView(view)
  })
}

const HANDLE_GAP = 6

class BlockHandleView {
  private host: HTMLElement | null
  private button: HTMLButtonElement
  private target: Target | null = null
  private frame: number | null = null

  constructor(private view: EditorView) {
    this.host = view.dom.parentElement
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'block-handle'
    this.button.title = 'Delete this block'
    this.button.setAttribute('aria-label', 'Delete this block')
    this.button.appendChild(createIcon('trash', 14))
    // Prevented, or the click moves focus out of the editor and the caret is
    // gone by the time the deletion lands.
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => this.remove())
    this.host?.appendChild(this.button)
    this.host?.addEventListener('mousemove', this.onMove)
    this.host?.addEventListener('mouseleave', this.onLeave)
  }

  private onMove = (event: MouseEvent): void => {
    // The handle is a child of the host, so moving onto it keeps firing this.
    // Re-aiming from a point over the button asks "which block is under the
    // margin?" — the answer is whatever ProseMirror snaps to, usually not the
    // block the handle belongs to, and the handle jumped away from under the
    // pointer just as it was reached.
    if (event.target instanceof Node && this.button.contains(event.target)) return
    if (this.frame !== null) return
    const { clientX, clientY } = event
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.aim(clientX, clientY)
    })
  }

  private onLeave = (): void => this.hide()

  /** Point the handle at the innermost deletable block under the pointer. */
  private aim(x: number, y: number): void {
    // Crossing the gutter towards the handle passes over no block at all, and
    // whatever `posAtCoords` snaps to out there is not what the author is
    // aiming for. While the pointer is level with the current block and no
    // further left than the handle, the handle stays where it is.
    if (this.target && this.holds(x, y)) return

    const found = this.view.posAtCoords({ left: x, top: y })
    if (!found) return this.hide()

    let pos: number | null = null
    if (found.inside >= 0) {
      const node = this.view.state.doc.nodeAt(found.inside)
      if (node && DELETABLE_BLOCKS.has(node.type.name)) pos = found.inside
    }
    if (pos === null) {
      const $pos = this.view.state.doc.resolve(found.pos)
      for (let depth = $pos.depth; depth > 0; depth--) {
        if (DELETABLE_BLOCKS.has($pos.node(depth).type.name)) {
          pos = $pos.before(depth)
          break
        }
      }
    }
    if (pos === null) return this.hide()

    const node = this.view.state.doc.nodeAt(pos)
    if (!node || !this.place(pos)) return this.hide()
    this.target = { pos, typeName: node.type.name }
  }

  /** Is the pointer still in the current block's band, gutter included? */
  private holds(x: number, y: number): boolean {
    const rect = this.rectFor(this.target?.pos)
    if (!rect) return false
    const reach = (this.button.offsetWidth || 22) + HANDLE_GAP + 8
    const inBand = y >= rect.top - 2 && y <= rect.bottom + 2
    const inReach = x >= rect.left - reach && x <= rect.right
    if (!inBand || !inReach) return false
    // Scrolling moves the block without a mousemove, so re-place before
    // deciding the handle is still in the right spot.
    return this.place(this.target!.pos)
  }

  private rectFor(pos: number | undefined): DOMRect | null {
    if (pos === undefined) return null
    const dom = this.view.nodeDOM(pos)
    return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
  }

  /** Put the handle in the margin beside the block at `pos`. */
  private place(pos: number): boolean {
    const host = this.host
    const rect = this.rectFor(pos)
    if (!host || !rect) return false
    const hostRect = host.getBoundingClientRect()
    const size = this.button.offsetWidth || 22
    // Clamped so a narrow pane, where the page fills its host, puts the
    // handle over the page's own margin rather than off the left edge.
    const left = Math.max(2, rect.left - hostRect.left + host.scrollLeft - size - HANDLE_GAP)
    this.button.style.left = `${left}px`
    this.button.style.top = `${rect.top - hostRect.top + host.scrollTop}px`
    this.button.classList.add('block-handle--on')
    return true
  }

  private hide(): void {
    this.button.classList.remove('block-handle--on')
    this.target = null
  }

  private remove(): void {
    const target = this.target
    if (!target) return
    // The document may have moved under a handle that's been sitting there;
    // only act if the block it was aimed at is still the one at that position.
    const node = this.view.state.doc.nodeAt(target.pos)
    if (!node || node.type.name !== target.typeName) return this.hide()
    const tr = deleteBlockAt(this.view.state, target.pos)
    this.hide()
    if (!tr) return
    this.view.dispatch(tr)
    this.view.focus()
  }

  update(_view: EditorView, prev: EditorState): void {
    // Positions shift as soon as the document changes, and a handle pointing
    // at a stale one is worse than no handle. The next mousemove re-aims it.
    // Selection-only updates are left alone, or the handle would blink out
    // every time the caret moved under it.
    if (this.target && prev.doc !== this.view.state.doc) this.hide()
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.host?.removeEventListener('mousemove', this.onMove)
    this.host?.removeEventListener('mouseleave', this.onLeave)
    this.button.remove()
    this.host = null
  }
}
