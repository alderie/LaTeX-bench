import { create } from 'zustand'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import { latexSchema } from './schema'

// A narrow channel between the React chrome (the toolbar) and the
// ProseMirror view, which lives outside React entirely.
//
// The view itself is kept in a module-level slot rather than in the store:
// putting a mutable, deeply-nested object in zustand would make every
// transaction a candidate for a React re-render. What the store holds is the
// small derived shape a toolbar actually needs — which marks are on, whether
// undo is available — and it is only written when that shape *changes*, so
// typing inside a bold run doesn't re-render the toolbar on every keystroke.

let activeView: EditorView | null = null

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view
  if (!view) useEditorSelection.setState(EMPTY_SELECTION)
}

export function getActiveEditorView(): EditorView | null {
  return activeView
}

export interface SelectionState {
  /** Names of marks active at the cursor / across the selection. */
  marks: string[]
  /** True when there is an editor to act on at all. */
  ready: boolean
}

const EMPTY_SELECTION: SelectionState = { marks: [], ready: false }

export const useEditorSelection = create<SelectionState>(() => EMPTY_SELECTION)

const TRACKED_MARKS = [
  'strong',
  'em',
  'code',
  'smallcaps',
  'underline',
  'superscript',
  'subscript'
]

/** Marks that would apply to text typed at the current selection. */
function activeMarks(state: EditorState): string[] {
  const { from, $from, to, empty } = state.selection
  const out: string[] = []
  for (const name of TRACKED_MARKS) {
    const type = latexSchema.marks[name]
    if (!type) continue
    const on = empty
      ? Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
      : state.doc.rangeHasMark(from, to, type)
    if (on) out.push(name)
  }
  return out
}

/**
 * Recompute the toolbar's view of the selection. Called from the editor's
 * dispatch; cheap, and skips the store write when nothing observable moved.
 */
export function publishSelection(state: EditorState): void {
  const marks = activeMarks(state)
  const previous = useEditorSelection.getState()
  if (
    previous.ready &&
    previous.marks.length === marks.length &&
    previous.marks.every((m, i) => m === marks[i])
  ) {
    return
  }
  useEditorSelection.setState({ marks, ready: true })
}

// ── Commands the toolbar runs ──────────────────────────────────────────

function run(command: Command): void {
  const view = activeView
  if (!view) return
  command(view.state, view.dispatch, view)
  // Focus goes back to the text: a toolbar that steals it makes the next
  // keystroke land nowhere.
  view.focus()
}

export function toggleEditorMark(name: string): void {
  const type = latexSchema.marks[name]
  if (!type) return
  run(toggleMark(type))
}

/** Insert an inline formula and open its editor. */
export function insertInlineMath(): void {
  const view = activeView
  if (!view) return
  const node = latexSchema.nodes.mathInline.create({ latex: 'x' })
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
  view.focus()
}

/** Insert a display equation on its own line. */
export function insertDisplayMath(): void {
  const view = activeView
  if (!view) return
  const node = latexSchema.nodes.mathBlock.create({
    latex: '\\begin{equation}\n  \n\\end{equation}',
    label: null
  })
  const { tr } = view.state
  const $from = view.state.selection.$from
  // Replace an empty paragraph rather than leaving a blank line above the
  // equation — the same rule the slash menu uses.
  if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
    const start = $from.before()
    tr.replaceWith(start, start + $from.parent.nodeSize, node)
  } else {
    tr.insert($from.after(), node)
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** Wrap the paragraph the cursor is in as a single-item list. */
export function insertList(kind: 'itemize' | 'enumerate'): void {
  const view = activeView
  if (!view) return
  const { $from } = view.state.selection
  if ($from.parent.type.name !== 'paragraph') return
  const paragraph = $from.parent
  const item = latexSchema.nodes.listItem.create({ marker: null }, [paragraph])
  const list = latexSchema.nodes.listBlock.create({ kind, options: '' }, [item])
  const start = $from.before()
  const tr = view.state.tr.replaceWith(start, start + paragraph.nodeSize, list)
  // Put the caret back inside the text that just became an item.
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start + 2, tr.doc.content.size))))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** Open the slash menu's insert flow by typing the trigger for the user. */
export function openInsertMenu(): void {
  const view = activeView
  if (!view) return
  view.focus()
  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText('/', from, to))
}
