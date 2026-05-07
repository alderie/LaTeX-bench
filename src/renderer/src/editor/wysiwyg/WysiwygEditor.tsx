import * as React from 'react'
import { useEffect, useRef } from 'react'
import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { inputRules } from 'prosemirror-inputrules'
import { latexSchema } from './schema'
import { parseLatexToDoc } from './latex-to-doc'
import { serializeDocToLatex } from './doc-to-latex'
import { mathNodeView, mathBlockNodeView } from './nodeviews/MathNodeView'
import { figureNodeView } from './nodeviews/FigureNodeView'
import { citationNodeView } from './nodeviews/CitationNodeView'
import { crossRefNodeView } from './nodeviews/CrossRefNodeView'
import { rawLatexNodeView } from './nodeviews/RawLatexNodeView'
import { preambleNodeView } from './nodeviews/PreambleNodeView'
import { mathInlineInputRule, mathBlockInputRule } from './inputRules'
import { usePaperStore } from '../../stores/paperStore'

export function WysiwygEditor(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const paperId = usePaperStore((s) => s.paperId)
  const setTex = usePaperStore((s) => s.setTex)
  // Load happens async — keep an effect-local cancel flag.
  useEffect(() => {
    if (!hostRef.current || !paperId) return undefined

    let cancelled = false
    const host = hostRef.current

    void (async () => {
      const tex = usePaperStore.getState().tex
      let doc
      try {
        const parsed = await parseLatexToDoc(tex)
        if (cancelled) return
        doc = parsed.doc
      } catch (err) {
        console.error('[wysiwyg] parse failed:', err)
        // Fallback: a single rawLatex block holding the whole file. The user
        // can still flip to Source mode and edit the .tex directly.
        doc = latexSchema.nodes.doc.create({}, [
          latexSchema.nodes.preamble.create({ source: '' }),
          latexSchema.nodes.rawLatex.create({ source: tex })
        ])
      }

      const state = EditorState.create({
        schema: latexSchema,
        doc,
        plugins: [
          history(),
          inputRules({ rules: [mathInlineInputRule, mathBlockInputRule] }),
          keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
          keymap(baseKeymap),
          markChanges()
        ]
      })

      const view = new EditorView(host, {
        state,
        nodeViews: {
          mathInline: mathNodeView,
          mathBlock: mathBlockNodeView,
          figure: figureNodeView,
          citation: citationNodeView,
          crossRef: crossRefNodeView,
          rawLatex: rawLatexNodeView,
          preamble: preambleNodeView
        },
        dispatchTransaction(tx) {
          const newState = view.state.apply(tx)
          view.updateState(newState)
          if (tx.docChanged) {
            try {
              const serialized = serializeDocToLatex(newState.doc)
              const cur = usePaperStore.getState()
              if (cur.tex !== serialized && !cur.applyingExternal) {
                setTex(serialized)
              }
            } catch (err) {
              console.error('[wysiwyg] serialize failed:', err)
            }
          }
        }
      })
      viewRef.current = view
    })()

    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
      host.replaceChildren()
    }
  }, [paperId, setTex])

  return <div ref={hostRef} className="wysiwyg-editor" />
}

// Marker plugin — currently a no-op; reserved for change tracking
// (numbering, decorations, etc.) we'll add in Phase 5.
function markChanges(): Plugin {
  return new Plugin({})
}
