import { getSearchQuery } from '@codemirror/search'
import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate
} from '@codemirror/view'

// Highlight every occurrence of the find query, and mark the one you are
// standing on.
//
// CodeMirror ships this, but only while its own search *panel* is open —
// the built-in highlighter bails on `if (!panel) return Decoration.none`.
// The whole point of the widget in `FindBar` is that CodeMirror's panel
// never opens, so the highlighting has to come from here. It reads the same
// query the commands read (`getSearchQuery`), so the two can't disagree.

const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const currentMark = Decoration.mark({
  class: 'cm-searchMatch cm-searchMatch-selected'
})

function buildDecorations(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state)
  if (!query.search || !query.valid) return Decoration.none

  const builder = new RangeSetBuilder<Decoration>()
  const selection = view.state.selection
  let last = -1

  for (const { from, to } of view.visibleRanges) {
    let cursor: Iterator<{ from: number; to: number }>
    try {
      cursor = query.getCursor(view.state, from, to)
    } catch {
      // An invalid regex the query object accepted but the engine didn't.
      return Decoration.none
    }
    for (;;) {
      const step = cursor.next()
      if (step.done) break
      const match = step.value
      // Zero-width matches (`x*`, `^`) have nothing to paint, and adjacent
      // visible ranges can hand back the same match twice.
      if (match.to <= match.from || match.from < last) continue
      last = match.from
      const isCurrent = selection.ranges.some((r) => r.from === match.from && r.to === match.to)
      builder.add(match.from, match.to, isCurrent ? currentMark : matchMark)
    }
  }
  return builder.finish()
}

/** Paints `.cm-searchMatch` for the current query over the visible lines. */
export const searchHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        getSearchQuery(update.state) !== getSearchQuery(update.startState)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
