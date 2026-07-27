import { create } from 'zustand'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model'
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

/**
 * What the caret is sitting in, as far as the toolbar is concerned.
 *
 * `body` is a paragraph; `1`–`5` are the heading levels, which map onto
 * `\section` … `\subparagraph`. `other` is everything else — a caption, a
 * bibliography entry, a cell — where changing the block kind is meaningless
 * and the control says so by being disabled.
 */
export type BlockKind = 'body' | 1 | 2 | 3 | 4 | 5 | 'other'

export interface SelectionState {
  /** Names of marks active at the cursor / across the selection. */
  marks: string[]
  /** The kind of block the caret is in. */
  block: BlockKind
  /** True when there is an editor to act on at all. */
  ready: boolean
}

const EMPTY_SELECTION: SelectionState = { marks: [], block: 'other', ready: false }

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

/** The heading level the caret is inside, or null when it isn't in one. */
function headingDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'sectionTitle') return depth
  }
  return null
}

/** Which entry in the block-kind menu describes the current selection. */
function activeBlock(state: EditorState): BlockKind {
  const { $from } = state.selection
  const depth = headingDepth($from)
  if (depth !== null) {
    const level = $from.node(depth).attrs.level as number
    return (Math.min(5, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5)
  }
  // Only a paragraph that could *become* a heading counts as body text — one
  // inside a float or a list item can't be promoted, because a `\section`
  // there would end the environment it is in.
  if ($from.parent.type.name !== 'paragraph') return 'other'
  return canHoldSection($from) ? 'body' : 'other'
}

/** Whether a `section` node is allowed where this paragraph sits. */
function canHoldSection($from: ResolvedPos): boolean {
  if ($from.depth < 1) return false
  const container = $from.node($from.depth - 1).type.name
  return container === 'doc' || container === 'section'
}

/**
 * Recompute the toolbar's view of the selection. Called from the editor's
 * dispatch; cheap, and skips the store write when nothing observable moved.
 */
export function publishSelection(state: EditorState): void {
  const marks = activeMarks(state)
  const block = activeBlock(state)
  const previous = useEditorSelection.getState()
  if (
    previous.ready &&
    previous.block === block &&
    previous.marks.length === marks.length &&
    previous.marks.every((m, i) => m === marks[i])
  ) {
    return
  }
  useEditorSelection.setState({ marks, block, ready: true })
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

// ── Headings ───────────────────────────────────────────────────────────
//
// A heading in this document is not a paragraph with a bigger font: it is a
// `section` node whose first child is the title and whose remaining children
// are everything the section contains, which is what `\section{…}` means in
// the file. So the three transitions are genuinely different operations:
//
//   body → heading    the paragraph becomes a title, and everything after it
//                     in the same container moves inside the new section
//   heading → heading  a level change, which is only an attribute
//   heading → body    the section unwraps, its title becoming a paragraph
//
// Nesting is left to the parser. Making a `\subsection` out of a top-level
// heading produces a level-2 section sitting where a level-1 one was, which
// serializes to exactly the `\subsection{…}` the author asked for; the next
// load re-nests it under whatever section precedes it.

/** Change what kind of block the caret is in. */
export function setBlockKind(kind: BlockKind): void {
  if (kind === 'other') return
  const view = activeView
  if (!view) return
  const { state } = view
  const { $from } = state.selection
  const depth = headingDepth($from)

  if (depth !== null) {
    if (kind === 'body') demoteHeading(view, $from, depth)
    else setHeadingLevel(view, $from, depth, kind)
    return
  }
  if (kind === 'body') return
  promoteParagraph(view, $from, kind)
}

/** A heading's level, on the title and on the section it heads. */
function setHeadingLevel(view: EditorView, $from: ResolvedPos, depth: number, level: number): void {
  const title = $from.node(depth)
  if ((title.attrs.level as number) === level) return
  const tr = view.state.tr
  tr.setNodeMarkup($from.before(depth), undefined, { ...title.attrs, level })
  // The section carries the level too — it's what the serializer reads to
  // choose the macro, and leaving the two disagreeing writes a `\section`
  // with a subsection's title styling.
  if (depth > 1) {
    const section = $from.node(depth - 1)
    if (section.type.name === 'section') {
      tr.setNodeMarkup($from.before(depth - 1), undefined, { ...section.attrs, level })
    }
  }
  view.dispatch(tr)
  view.focus()
}

/**
 * Turn the paragraph the caret is in into a heading.
 *
 * Everything after it in the same container moves inside the new section:
 * that is what a heading does in LaTeX, and leaving the following prose
 * outside would produce a `\section{…}` immediately followed by `\section`'s
 * worth of text that the next parse would swallow anyway — the document would
 * silently rearrange itself on reload.
 */
function promoteParagraph(view: EditorView, $from: ResolvedPos, level: number): void {
  if (!canHoldSection($from)) return
  const depth = $from.depth
  const paragraph = $from.parent
  const container = $from.node(depth - 1)
  const index = $from.index(depth - 1)

  const following: PMNode[] = []
  for (let i = index + 1; i < container.childCount; i++) following.push(container.child(i))

  const title = latexSchema.nodes.sectionTitle.create({ level }, paragraph.content)
  const section = latexSchema.nodes.section.create(
    { id: '', level, starred: false, labels: [] },
    [title, ...following]
  )

  const from = $from.before(depth)
  const tr = view.state.tr.replaceWith(from, $from.end(depth - 1), section)
  // Into the title, at the same offset in the text the caret already had.
  const at = Math.min(from + 2 + $from.parentOffset, tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(at)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** Unwrap a section: its title becomes a paragraph, its body stays put. */
function demoteHeading(view: EditorView, $from: ResolvedPos, depth: number): void {
  if (depth < 1) return
  const section = $from.node(depth - 1)
  if (section.type.name !== 'section') return
  const title = section.firstChild
  if (!title) return

  const rest: PMNode[] = []
  for (let i = 1; i < section.childCount; i++) rest.push(section.child(i))

  const paragraph = latexSchema.nodes.paragraph.create(null, title.content)
  const from = $from.before(depth - 1)
  const tr = view.state.tr.replaceWith(from, from + section.nodeSize, [paragraph, ...rest])
  const at = Math.min(from + 1 + $from.parentOffset, tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(at)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
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
