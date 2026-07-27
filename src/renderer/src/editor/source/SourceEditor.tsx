import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  type Command
} from '@codemirror/view'
import {
  addCursorAbove,
  addCursorBelow,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  codeFolding,
  defaultHighlightStyle,
  foldAll,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  toggleFold,
  unfoldAll
} from '@codemirror/language'
import {
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  highlightSelectionMatches,
  search,
  selectMatches,
  selectNextOccurrence
} from '@codemirror/search'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { Map as MapIcon, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { usePaperStore } from '../../stores/paperStore'
import { useUiStore } from '../../stores/uiStore'
import { latexCompletions, latexSupport } from './latex-language'
import { searchHighlight } from './search-highlight'
import {
  countFolded,
  currentHeading,
  describeFold,
  foldMarkerDOM,
  foldPlaceholderDOM,
  foldToLevel,
  headingLines,
  type Heading
} from './fold-commands'
import { headingTitle } from '../sections'
import { notifySourceUpdate, setActiveSourceView } from './source-bridge'
import { SourceMinimap } from './SourceMinimap'
import { positionKey, readSourcePosition, writeSourcePosition } from './source-position'

// The LaTeX source view.
//
// This is the escape hatch from the rich editor, and an escape hatch that is
// worse than the editor someone would otherwise use is one they resent
// reaching for. So it carries what a writing surface for a paper needs:
// folding for the environment you are not currently in, a linter for the two
// mistakes that cost an hour of compile-and-scroll, completion that knows the
// document's own labels and macros, a minimap for the two thousand lines you
// are not looking at, and a status line that says where you are.

// Annotation to mark transactions originated from an external source
// (paper load, MCP push) so we don't echo them back to disk.
const EXTERNAL_ANNOTATION = Annotation.define<boolean>()

// Colours come from CSS variables so the two themes are defined in one place
// — main.css, next to every other colour in the app — rather than being
// duplicated as literals here and going out of step with the dark theme.
const latexHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-macro)', fontWeight: '600' },
  { tag: t.macroName, color: 'var(--code-macro)' },
  { tag: t.tagName, color: 'var(--code-macro)' },
  { tag: t.bracket, color: 'var(--text-tertiary)' },
  { tag: t.string, color: 'var(--code-string)' },
  { tag: t.comment, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--code-string)' },
  { tag: t.operator, color: 'var(--text-secondary)' },
  { tag: t.atom, color: 'var(--code-env)' },
  { tag: t.heading, color: 'var(--text-primary)', fontWeight: '700' }
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13.5px'
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    padding: '12px 0'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    border: 'none',
    paddingRight: '8px'
  },
  '.cm-activeLine': { backgroundColor: 'var(--editor-line)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)'
  },

  // ── Caret and selection ──────────────────────────────────────────────
  //
  // Both used to be borrowed tokens: the caret took --accent-color (pure
  // black in the light theme, so it vanished between the black glyphs it
  // sits between) and the selection took --bg-secondary, the panel grey.
  //
  // And neither rule was reaching the page at all. CodeMirror's base themes
  // scope their defaults as `&light .cm-selectionBackground`, which compiles
  // to `.cm-editor.cm-light .cm-selectionBackground` — three classes against
  // the two a plain selector in a user theme gets, so the base theme won on
  // specificity no matter what we wrote here. That is why a selection came
  // out in CodeMirror's stock lavender. `!important` is the reliable way
  // past it; a `&light`-scoped selector isn't available to user themes.
  '.cm-cursor': {
    borderLeft: '2px solid var(--editor-cursor) !important',
    marginLeft: '-1px'
  },
  '.cm-dropCursor': { borderLeft: '2px solid var(--editor-cursor) !important' },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection-blur) !important'
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection) !important'
  },
  // The word under the caret, echoed wherever else it appears.
  '.cm-selectionMatch': {
    backgroundColor: 'var(--editor-occurrence) !important'
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--editor-match) !important',
    borderRadius: '2px'
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'var(--editor-match-current) !important',
    outline: '1px solid var(--editor-match-outline)'
  },
  '&.cm-focused': { outline: 'none' },

  '.cm-panels': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-color)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.18)',
    fontFamily: 'var(--font-sans)',
    overflow: 'hidden'
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--overlay-hover)',
    color: 'var(--text-primary)'
  },
  '.cm-completionDetail': {
    marginLeft: '10px',
    fontFamily: 'var(--font-sans)',
    fontStyle: 'normal',
    color: 'var(--text-tertiary)'
  },

  // ── Folding ──────────────────────────────────────────────────────────
  '.cm-foldGutter': { minWidth: '14px' },
  '.cm-foldMarker': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 0.12s ease'
  },
  // Present when you go looking for it, invisible while you read. A folded
  // range keeps its chevron regardless — it is the only sign the lines are
  // there at all. (Two rules rather than one comma-separated selector:
  // CodeMirror only prefixes the first selector in a list with the theme
  // class, so the second would escape the editor's scope.)
  '&:hover .cm-foldMarker': { opacity: '1' },
  '.cm-foldMarker--closed': { opacity: '1' },
  '.cm-foldMarker--closed svg': { transform: 'rotate(-90deg)' },
  '.cm-foldMarker:hover': { color: 'var(--text-primary)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    color: 'var(--text-secondary)',
    fontSize: '11px',
    padding: '0 6px',
    margin: '0 4px',
    cursor: 'pointer'
  },
  '.cm-foldPlaceholder:hover': {
    borderColor: 'var(--editor-cursor)',
    color: 'var(--text-primary)'
  }
})

/**
 * Only run a search command when there is something to search for.
 *
 * CodeMirror's `findNext` and friends fall back to `openSearchPanel` when the
 * query is empty — which is exactly the second find bar this app used to grow
 * on Ctrl+F. Pressing F3 with no query opens *our* widget instead.
 */
function guardedSearch(command: Command): Command {
  return (view) => {
    const query = getSearchQuery(view.state)
    if (!query.search || !query.valid) {
      useUiStore.getState().openFind()
      return true
    }
    return command(view)
  }
}

/** Where the caret is, for the status line under the editor. */
interface Cursor {
  line: number
  column: number
  lines: number
  selected: number
}

const NO_CURSOR: Cursor = { line: 1, column: 1, lines: 1, selected: 0 }

/** The slower-moving half of the status line, recomputed off the keystroke. */
interface DocStats {
  words: number
  folded: number
  /** Every heading in the document, so the breadcrumb is a lookup. */
  headings: Heading[]
}

const NO_STATS: DocStats = { words: 0, folded: 0, headings: [] }

function countWords(text: string): number {
  // Macros and their braces are markup, not prose: `\section{Results}` is one
  // word. Stripping them first is the difference between a word count and a
  // token count.
  const prose = text
    .replace(/%.*$/gm, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}[\]$&\\]/g, ' ')
  const match = prose.match(/[\p{L}\p{N}'’-]+/gu)
  return match ? match.length : 0
}

export function SourceEditor(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const externalCompartment = useRef(new Compartment()).current
  const paperId = usePaperStore((s) => s.paperId)
  const activeFile = usePaperStore((s) => s.activeFile)
  const setTex = usePaperStore((s) => s.setTex)
  const minimapOpen = useUiStore((s) => s.minimapOpen)
  const toggleMinimap = useUiStore((s) => s.toggleMinimap)
  const [cursor, setCursor] = useState<Cursor>(NO_CURSOR)
  const [stats, setStats] = useState<DocStats>(NO_STATS)
  // In state rather than a ref so the minimap mounts once the view exists.
  const [view, setView] = useState<EditorView | null>(null)

  // Mount once; subsequent paper loads patch the doc through dispatch.
  useEffect(() => {
    if (!hostRef.current) return undefined

    // The heavier per-document sums — word count, fold count, the heading
    // list the breadcrumb reads — are recomputed on a trailing timer rather
    // than per keystroke. They are reference, and reference that is 300ms
    // stale is indistinguishable from one that is current.
    let statsTimer: ReturnType<typeof setTimeout> | null = null
    const recomputeStats = (state: EditorState): void => {
      const headings = headingLines(state).map((heading) => ({
        ...heading,
        title: headingTitle(state.doc.line(heading.line).text)
      }))
      setStats({
        words: countWords(state.doc.toString()),
        folded: countFolded(state),
        headings
      })
    }
    const scheduleStats = (state: EditorState): void => {
      if (statsTimer) clearTimeout(statsTimer)
      statsTimer = setTimeout(() => recomputeStats(state), 300)
    }

    const initial = usePaperStore.getState().tex
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        // Alt-click and Ctrl-click put a second caret down; without this the
        // rectangular selection above has nowhere to put its extra ranges.
        EditorState.allowMultipleSelections.of(true),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        codeFolding({
          preparePlaceholder: describeFold,
          placeholderDOM: foldPlaceholderDOM
        }),
        foldGutter({ markerDOM: foldMarkerDOM }),
        lintGutter(),
        autocompletion({ override: [latexCompletions], icons: false }),
        highlightSelectionMatches(),
        // The state and the commands, but never the panel: the widget in
        // `FindBar` is the one find UI, and it drives this.
        search({ literal: false }),
        searchHighlight,
        // The last line of a paper sits at the bottom edge of the window
        // otherwise, which is a bad place to write.
        scrollPastEnd(),
        // Long `\newcommand` definitions and prose paragraphs both run past
        // the pane; a horizontal scrollbar for either is a worse answer.
        EditorView.lineWrapping,
        latexSupport(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(latexHighlight),
        editorTheme,
        keymap.of([
          ...closeBracketsKeymap,
          // Ahead of the default keymap so Tab accepts a completion when one
          // is showing, and indents when one isn't.
          { key: 'Tab', run: acceptCompletion },
          { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
          {
            key: 'Mod-Shift-l',
            run: guardedSearch(selectMatches),
            preventDefault: true
          },
          {
            key: 'F3',
            run: guardedSearch(findNext),
            shift: guardedSearch(findPrevious)
          },
          { key: 'Mod-g', run: gotoLine, preventDefault: true },
          { key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
          {
            key: 'Mod-Alt-ArrowDown',
            run: addCursorBelow,
            preventDefault: true
          },
          // VS Code's folding chords, on a document whose outline levels are
          // already named by the markup.
          { key: 'Mod-k Mod-0', run: foldAll },
          { key: 'Mod-k Mod-j', run: unfoldAll },
          { key: 'Mod-k Mod-1', run: foldToLevel(1) },
          { key: 'Mod-k Mod-2', run: foldToLevel(2) },
          { key: 'Mod-k Mod-3', run: foldToLevel(3) },
          { key: 'Mod-k Mod-l', run: toggleFold },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...foldKeymap,
          ...lintKeymap,
          indentWithTab
        ]),
        externalCompartment.of([]),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const { doc, selection } = update.state
            const head = selection.main.head
            const line = doc.lineAt(head)
            setCursor({
              line: line.number,
              column: head - line.from + 1,
              lines: doc.lines,
              selected: selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0)
            })
          }
          if (update.docChanged || update.selectionSet || update.transactions.length) {
            notifySourceUpdate()
          }
          if (update.docChanged || update.transactions.some((tx) => tx.effects.length)) {
            scheduleStats(update.state)
          }
          if (!update.docChanged) return
          const tx = update.transactions[0]
          if (tx?.annotation(EXTERNAL_ANNOTATION)) return
          setTex(update.state.doc.toString())
        })
      ]
    })

    const created = new EditorView({ state, parent: hostRef.current })
    viewRef.current = created
    setView(created)
    setActiveSourceView(created)
    recomputeStats(created.state)

    return () => {
      if (statsTimer) clearTimeout(statsTimer)
      setActiveSourceView(null)
      created.destroy()
      viewRef.current = null
      setView(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync doc on paper change. Reads the latest tex from the store directly
  // to avoid a render-thrashing dependency chain.
  useEffect(() => {
    const current = viewRef.current
    if (!current) return undefined

    const sync = (): void => {
      const next = usePaperStore.getState().tex
      const cur = current.state.doc.toString()
      if (cur !== next) {
        current.dispatch({
          changes: { from: 0, to: cur.length, insert: next },
          annotations: EXTERNAL_ANNOTATION.of(true)
        })
      }
    }

    // Trigger a sync immediately for the new paper.
    sync()

    // Reopening a paper puts you back where you stopped writing, rather than
    // at line 1 of a file you were 800 lines into.
    if (paperId) {
      const saved = readSourcePosition(positionKey(paperId, activeFile))
      if (saved && saved.anchor <= current.state.doc.length) {
        current.dispatch({
          selection: { anchor: saved.anchor, head: saved.head },
          effects: EditorView.scrollIntoView(saved.anchor, { y: 'center' }),
          annotations: EXTERNAL_ANNOTATION.of(true)
        })
      }
    }

    // Listen for store changes that bump tex (load, MCP push) while the
    // paper id stays stable.
    const unsubscribe = usePaperStore.subscribe((s, prev) => {
      if (s.paperId !== prev.paperId) return
      if (s.tex !== prev.tex && s.applyingExternal) sync()
    })

    const id = paperId
    const file = activeFile
    return () => {
      unsubscribe()
      if (id && viewRef.current) {
        const { main } = viewRef.current.state.selection
        writeSourcePosition(positionKey(id, file), { anchor: main.anchor, head: main.head })
      }
    }
  }, [paperId, activeFile])

  const run = useCallback((command: Command): void => {
    const target = viewRef.current
    if (!target) return
    command(target)
    target.focus()
  }, [])

  const section = currentHeading(stats.headings, cursor.line)

  return (
    <div className="source-editor">
      <div className="source-editor__host">
        <div className="source-editor__scroll" ref={hostRef} />
        {minimapOpen && <SourceMinimap view={view} />}
      </div>
      <div className="source-editor__status">
        <span title="Line and column">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="source-editor__status-sep">·</span>
        <span>{cursor.lines.toLocaleString()} lines</span>
        <span className="source-editor__status-sep">·</span>
        <span title="Words of prose, excluding macros">{stats.words.toLocaleString()} words</span>
        {cursor.selected > 0 && (
          <>
            <span className="source-editor__status-sep">·</span>
            <span>{cursor.selected.toLocaleString()} selected</span>
          </>
        )}
        {section && (
          <>
            <span className="source-editor__status-sep">·</span>
            <span className="source-editor__crumb" title="Section at the caret">
              {section}
            </span>
          </>
        )}
        <span className="source-editor__spacer" />
        <button
          className="source-editor__status-button"
          title="Collapse to section headings  (Ctrl+K Ctrl+1)"
          onClick={() => run(foldToLevel(1))}
        >
          <ChevronsDownUp size={12} />
        </button>
        <button
          className="source-editor__status-button"
          title="Expand everything  (Ctrl+K Ctrl+J)"
          onClick={() => run(unfoldAll)}
        >
          <ChevronsUpDown size={12} />
        </button>
        {stats.folded > 0 && <span>{stats.folded} folded</span>}
        <button
          className={
            'source-editor__status-button' +
            (minimapOpen ? ' source-editor__status-button--on' : '')
          }
          title={minimapOpen ? 'Hide minimap' : 'Show minimap'}
          aria-pressed={minimapOpen}
          onClick={toggleMinimap}
        >
          <MapIcon size={12} />
        </button>
        <span className="source-editor__status-hint">⌘F find · ⌘D next · LaTeX</span>
      </div>
    </div>
  )
}
