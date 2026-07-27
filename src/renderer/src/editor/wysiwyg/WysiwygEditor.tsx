import * as React from 'react'
import { useEffect, useRef } from 'react'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { inputRules } from 'prosemirror-inputrules'
import { latexSchema } from './schema'
import { parseLatexToDoc } from './latex-to-doc'
import { serializeDocToLatex } from './doc-to-latex'
import { mathNodeView, mathBlockNodeView, setMathMacros } from './nodeviews/MathNodeView'
import { figureNodeView } from './nodeviews/FigureNodeView'
import { citationNodeView } from './nodeviews/CitationNodeView'
import { crossRefNodeView } from './nodeviews/CrossRefNodeView'
import { rawLatexNodeView } from './nodeviews/RawLatexNodeView'
import { preambleNodeView } from './nodeviews/PreambleNodeView'
import { theoremNodeView } from './nodeviews/TheoremNodeView'
import { codeBlockNodeView } from './nodeviews/CodeBlockNodeView'
import { captionNodeView } from './nodeviews/CaptionNodeView'
import { footnoteNodeView } from './nodeviews/FootnoteNodeView'
import { mathInlineInputRule, mathBlockInputRule } from './inputRules'
import { slashMenu } from './slashMenu'
import * as labelRegistry from './labelRegistry'
import { usePaperStore } from '../../stores/paperStore'

export function WysiwygEditor(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Kept so unmount can flush a pending save rather than dropping it.
  const syncRef = useRef<DeferredSync | null>(null)
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
        // Hand the preamble's \newcommand / \DeclareMathOperator macros
        // to KaTeX so user-defined notation (\norm, \E, \PP, \inner, …)
        // renders instead of showing as red unknown-command text.
        setMathMacros(parsed.mathMacros ?? {})
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
          // Ahead of the keymaps: ProseMirror consults `handleKeyDown` in
          // plugin order, and the base keymap would turn the Enter that
          // picks a menu item into a paragraph split before the menu ever
          // sees the key.
          slashMenu(),
          inputRules({ rules: [mathInlineInputRule, mathBlockInputRule] }),
          keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
          keymap(baseKeymap),
          markChanges()
        ]
      })

      // Renumbering and serializing are whole-document walks. Running them
      // inside `dispatchTransaction` put both on the critical path of every
      // keystroke, which is what made typing feel heavy in a long paper.
      // They only need to be current by the time the user pauses.
      const syncDoc = makeDeferredSync((docNow: PMNode) => {
        // Renumber first: if serialize throws, the numbering is still right.
        labelRegistry.rebuild(docNow)
        try {
          const serialized = serializeDocToLatex(docNow)
          const cur = usePaperStore.getState()
          if (cur.tex !== serialized && !cur.applyingExternal) setTex(serialized)
        } catch (err) {
          console.error('[wysiwyg] serialize failed:', err)
        }
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
          preamble: preambleNodeView,
          theoremEnv: theoremNodeView,
          codeBlock: codeBlockNodeView,
          caption: captionNodeView,
          footnote: footnoteNodeView
        },
        dispatchTransaction(tx) {
          const newState = view.state.apply(tx)
          view.updateState(newState)
          if (tx.docChanged) syncDoc.schedule(newState.doc)
        }
      })
      // Initial population — this is what populates labels for the
      // freshly-loaded doc before any user edits.
      labelRegistry.rebuild(state.doc)
      syncRef.current = syncDoc
      viewRef.current = view
    })()

    return () => {
      cancelled = true
      syncRef.current?.flush()
      syncRef.current = null
      viewRef.current?.destroy()
      viewRef.current = null
      host.replaceChildren()
    }
  }, [paperId, setTex])

  return <div ref={hostRef} className="wysiwyg-editor" />
}

// A trailing-edge debounce that always has the *latest* document.
//
// Deliberately not a generic utility: the contract here is that the pending
// work is idempotent and only the newest document matters, so a burst of
// keystrokes collapses to one renumber-and-serialize. `flush` exists so
// unmounting (switching papers, closing the window) can't lose the last
// edit — the alternative is a save that silently never happens.
interface DeferredSync {
  schedule(doc: PMNode): void
  flush(): void
}

const SYNC_DELAY_MS = 180

function makeDeferredSync(run: (doc: PMNode) => void): DeferredSync {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: PMNode | null = null

  const fire = (): void => {
    timer = null
    const doc = pending
    pending = null
    if (doc) run(doc)
  }

  return {
    schedule(doc) {
      pending = doc
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(fire, SYNC_DELAY_MS)
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        fire()
      }
    }
  }
}

// Marker plugin — currently a no-op; reserved for change tracking
// (numbering, decorations, etc.) we'll add in Phase 5.
function markChanges(): Plugin {
  return new Plugin({})
}
