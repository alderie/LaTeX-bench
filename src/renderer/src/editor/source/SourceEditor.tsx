import * as React from 'react'
import { useEffect, useRef } from 'react'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { tags as t } from '@lezer/highlight'
import { usePaperStore } from '../../stores/paperStore'

// Annotation to mark transactions originated from an external source
// (paper load, MCP push) so we don't echo them back to disk.
const EXTERNAL_ANNOTATION = Annotation.define<boolean>()

const latexHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--text-primary)', fontWeight: '600' },
  { tag: t.macroName, color: '#3858a8' },
  { tag: t.tagName, color: '#3858a8' },
  { tag: t.bracket, color: 'var(--text-tertiary)' },
  { tag: t.string, color: '#7c5e00' },
  { tag: t.comment, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: t.number, color: '#7c5e00' },
  { tag: t.operator, color: 'var(--text-secondary)' },
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
  '&.cm-focused': { outline: 'none' }
})

export function SourceEditor(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const externalCompartment = useRef(new Compartment()).current
  const paperId = usePaperStore((s) => s.paperId)
  const setTex = usePaperStore((s) => s.setTex)

  // Mount once; subsequent paper loads patch the doc through dispatch.
  useEffect(() => {
    if (!hostRef.current) return undefined

    const initial = usePaperStore.getState().tex
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        StreamLanguage.define(stex),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(latexHighlight),
        editorTheme,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          indentWithTab
        ]),
        externalCompartment.of([]),
        EditorView.updateListener.of((update) => {
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

  return <div ref={hostRef} className="source-editor" />
}
