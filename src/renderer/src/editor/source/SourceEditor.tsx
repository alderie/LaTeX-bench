import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
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
  rectangularSelection
} from '@codemirror/view'
import {
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
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
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
import { usePaperStore } from '../../stores/paperStore'
import { latexCompletions, latexSupport } from './latex-language'

// The LaTeX source view.
//
// This is the escape hatch from the rich editor, and an escape hatch that is
// worse than the editor someone would otherwise use is one they resent
// reaching for. So it carries what a writing surface for a paper needs:
// folding for the environment you are not currently in, a linter for the two
// mistakes that cost an hour of compile-and-scroll, completion that knows the
// document's own labels and macros, and a status line that says where you are
// in a file that is thousands of lines long.

// Annotation to mark transactions originated from an external source
// (paper load, MCP push) so we don't echo them back to disk.
const EXTERNAL_ANNOTATION = Annotation.define<boolean>()

// Colours come from CSS variables so the two themes are defined in one place
// — App.css, next to every other colour in the app — rather than being
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
  '.cm-content': { caretColor: 'var(--accent-color)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    border: 'none',
    paddingRight: '8px'
  },
  '.cm-foldGutter span': { color: 'var(--text-tertiary)', cursor: 'pointer' },
  '.cm-activeLine': { backgroundColor: 'var(--overlay-hover)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)'
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--bg-secondary)'
  },
  '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': {
    backgroundColor: 'var(--bg-secondary)'
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
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    color: 'var(--text-secondary)',
    padding: '0 6px',
    margin: '0 2px'
  }
})

/** Where the caret is, for the status line under the editor. */
interface Cursor {
  line: number
  column: number
  lines: number
  selected: number
}

const NO_CURSOR: Cursor = { line: 1, column: 1, lines: 1, selected: 0 }

export function SourceEditor(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const externalCompartment = useRef(new Compartment()).current
  const paperId = usePaperStore((s) => s.paperId)
  const setTex = usePaperStore((s) => s.setTex)
  const [cursor, setCursor] = useState<Cursor>(NO_CURSOR)

  // Mount once; subsequent paper loads patch the doc through dispatch.
  useEffect(() => {
    if (!hostRef.current) return undefined

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
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        codeFolding(),
        foldGutter(),
        lintGutter(),
        autocompletion({ override: [latexCompletions], icons: false }),
        highlightSelectionMatches(),
        // Above the editor rather than below it: a find bar at the bottom of
        // a full-height pane sits where the last line of the file is.
        search({ top: true }),
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
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
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
          if (!update.docChanged) return
          const tx = update.transactions[0]
          if (tx?.annotation(EXTERNAL_ANNOTATION)) return
          setTex(update.state.doc.toString())
        })
      ]
    })

    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync doc on paper change. Reads the latest tex from the store directly
  // to avoid a render-thrashing dependency chain.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return undefined

    const sync = (): void => {
      const next = usePaperStore.getState().tex
      const cur = view.state.doc.toString()
      if (cur !== next) {
        view.dispatch({
          changes: { from: 0, to: cur.length, insert: next },
          annotations: EXTERNAL_ANNOTATION.of(true)
        })
      }
    }

    // Trigger a sync immediately for the new paper.
    sync()

    // Listen for store changes that bump tex (load, MCP push) while the
    // paper id stays stable.
    const unsubscribe = usePaperStore.subscribe((s, prev) => {
      if (s.paperId !== prev.paperId) return
      if (s.tex !== prev.tex && s.applyingExternal) sync()
    })
    return unsubscribe
  }, [paperId])

  return (
    <div className="source-editor">
      <div className="source-editor__host" ref={hostRef} />
      <div className="source-editor__status">
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="source-editor__status-sep">·</span>
        <span>{cursor.lines.toLocaleString()} lines</span>
        {cursor.selected > 0 && (
          <>
            <span className="source-editor__status-sep">·</span>
            <span>{cursor.selected.toLocaleString()} selected</span>
          </>
        )}
        <span className="source-editor__spacer" />
        <span className="source-editor__status-hint">⌘F find · ⌘D next match · LaTeX</span>
      </div>
    </div>
  )
}
