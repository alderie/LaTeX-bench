import { chainCommands } from 'prosemirror-commands'
import { wrappingInputRule } from 'prosemirror-inputrules'
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import type { ResolvedPos } from 'prosemirror-model'
import { latexSchema } from './schema'

// Lists you can actually edit.
//
// `itemize` and `enumerate` parsed, serialized and rendered — and that was
// all. There was no way to make one out of a paragraph, no way to get out of
// one, and Enter inside an item split the *paragraph* rather than the item,
// which put a second paragraph under the same bullet and produced an `\item`
// with a blank line in the middle of it. Tab did nothing, so a nested list
// could be read but never written. In practice a list was something you
// pasted in from Source view.
//
// The four operations are prosemirror-schema-list's, which is the reference
// implementation of exactly this and gets the edge cases (splitting a nested
// item, lifting the last item of a sub-list) right. What's here is the part
// that is ours: which node types they act on, what Backspace means at the
// head of an item, and the fact that switching a list's kind is an attribute
// change rather than an unwrap-and-rewrap — `\begin{itemize}` and
// `\begin{enumerate}` differ by a word, and rebuilding the nodes would throw
// away every `\item[term]` marker and the enumitem options with them.

const { listBlock, listItem } = latexSchema.nodes

export type ListKind = 'itemize' | 'enumerate' | 'description'

/** The list the caret is inside, innermost first, or null. */
export function listAt($from: ResolvedPos): { depth: number; kind: ListKind } | null {
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type === listBlock) {
      return { depth, kind: (node.attrs.kind as ListKind) ?? 'itemize' }
    }
  }
  return null
}

/** Which list kind the toolbar should show as active. */
export function activeListKind(state: EditorState): ListKind | null {
  return listAt(state.selection.$from)?.kind ?? null
}

// ── The commands ───────────────────────────────────────────────────────

export const splitItem = splitListItem(listItem)
export const liftItem = liftListItem(listItem)

/**
 * Nest the item one level deeper, in a list of the same kind.
 *
 * `sinkListItem` builds the inner list with `null` attrs, which here means
 * the schema's default — so Tab inside an `enumerate` produced an `itemize`
 * under it, and a numbered outline turned into bullets one level down. The
 * kind comes from the list being nested into instead; `options` deliberately
 * does not, because enumitem's `[label=…]` describes the level it was
 * written on and copying it down would renumber the sublist to match its
 * parent.
 */
export const sinkItem: Command = (state, dispatch, view) => {
  const outer = listAt(state.selection.$from)
  if (!outer) return false
  const kind = outer.kind

  const fix = dispatch
    ? (tr: Transaction): void => {
        const $from = tr.selection.$from
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth)
          if (node.type !== listBlock) continue
          // The innermost one is the list that was just created.
          if (node.attrs.kind !== kind) {
            tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, kind })
          }
          break
        }
        dispatch(tr)
      }
    : undefined

  return sinkListItem(listItem)(state, fix, view)
}

/**
 * Backspace at the very start of an item's first paragraph outdents it.
 *
 * The base keymap's answer is `joinBackward`, which on a `defining` node like
 * `listItem` is a no-op — so the first item of a list was a place the caret
 * could get into and not back out of without reaching for the mouse. Only
 * fires at offset zero of the item, so Backspace anywhere else still deletes
 * a character.
 */
const outdentOnBackspace: Command = (state, dispatch, view) => {
  const { $from, empty } = state.selection
  if (!empty) return false
  if ($from.parentOffset > 0) return false
  const list = listAt($from)
  if (!list) return false
  // Only from the first block of the item: Backspace at the head of an item's
  // *second* paragraph should join it to the first, not lift the whole item.
  if ($from.index(list.depth + 1) !== 0) return false
  return liftItem(state, dispatch, view)
}

/**
 * Enter inside an item.
 *
 * Two commands, because `splitListItem` deliberately does not handle the case
 * that matters most: on an empty item at the top level of a list it declines
 * and leaves the key to whatever comes next, expecting that to be a lift. Bind
 * only the split and pressing Enter on the empty item you just made does
 * nothing at all — the list becomes a room with no door. Chained, Enter twice
 * ends a list, which is what every editor does and what everybody's fingers
 * already know.
 */
export const listKeymap: Record<string, Command> = {
  Enter: chainCommands(splitItem, liftItem),
  Tab: sinkItem,
  'Shift-Tab': liftItem,
  // The conventional outdent/indent pair, for keyboards where Tab is spoken
  // for by something else.
  'Mod-[': liftItem,
  'Mod-]': sinkItem,
  Backspace: outdentOnBackspace
}

/**
 * Make a list, change a list's kind, or get out of one.
 *
 * Three different edits behind one button, which is what the button means:
 * pressing "bulleted" in a numbered list should give you a bulleted list, and
 * pressing it again should give you your paragraph back.
 */
export function toggleList(kind: ListKind): Command {
  return (state, dispatch, view) => {
    const list = listAt(state.selection.$from)
    if (!list) return wrapInList(listBlock, { kind, options: '' })(state, dispatch, view)

    if (list.kind === kind) return liftItem(state, dispatch, view)

    if (dispatch) {
      const { $from } = state.selection
      const pos = $from.before(list.depth)
      const node = $from.node(list.depth)
      // enumitem's `[…]` describes how *this* list is labelled, and a
      // `label=(\roman*)` carried onto an itemize would compile to something
      // the author never asked for. The markers on the items are the author's
      // own text, so those stay.
      dispatch(
        state.tr
          .setNodeMarkup(pos, undefined, { ...node.attrs, kind, options: '' })
          .scrollIntoView()
      )
    }
    return true
  }
}

// ── Typing a list into existence ───────────────────────────────────────
//
// `- ` and `1. ` at the head of a paragraph. These are the markers people
// already type when they are sketching a list in prose, and the alternative
// — remembering that the menu calls it "itemize" — is the thing that makes an
// editor feel like a form.
//
// Both are ordinary input rules, so the undo that follows immediately after
// puts the literal characters back.

export const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, listBlock, {
  kind: 'itemize',
  options: ''
})

export const orderedListRule = wrappingInputRule(/^(\d+)[.)]\s$/, listBlock, {
  kind: 'enumerate',
  options: ''
})

/**
 * Wrap the selection in a list and put the caret in the first item.
 *
 * Used by the toolbar and the command palette, where "insert a list" should
 * leave you typing in it rather than beside it.
 */
export function insertList(kind: ListKind): Command {
  return chainCommands(
    wrapInList(listBlock, { kind, options: '' }),
    // Nothing to wrap — an empty document, or a selection a list can't live
    // in. Put one in outright rather than doing nothing.
    (state, dispatch) => {
      if (!dispatch) return true
      const item = listItem.create({ marker: null }, [latexSchema.nodes.paragraph.create()])
      const list = listBlock.create({ kind, options: '' }, [item])
      const tr = state.tr.replaceSelectionWith(list)
      const at = Math.min(tr.selection.from - list.nodeSize + 2, tr.doc.content.size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, at))))
      dispatch(tr.scrollIntoView())
      return true
    }
  )
}
