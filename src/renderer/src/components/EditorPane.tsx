import * as React from 'react'
import { Suspense, lazy } from 'react'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import { EditorToolbar } from './EditorToolbar'

// CodeMirror / ProseMirror are heavy — split into their own chunks.
const SourceEditor = lazy(() =>
  import('../editor/source/SourceEditor').then((m) => ({ default: m.SourceEditor }))
)
const WysiwygEditor = lazy(() =>
  import('../editor/wysiwyg/WysiwygEditor').then((m) => ({ default: m.WysiwygEditor }))
)

export function EditorPane(): React.JSX.Element {
  const paperId = usePaperStore((s) => s.paperId)
  const viewMode = useUiStore((s) => s.viewMode)

  if (!paperId) {
    return (
      <main className="editor-pane">
        <div className="editor-pane__placeholder">
          <span>Select a paper or create a new one to start writing.</span>
        </div>
      </main>
    )
  }

  return (
    <main className="editor-pane">
      <EditorToolbar />
      <div className="editor-pane__body">
        {viewMode === 'source' ? (
          <Suspense fallback={<div className="editor-pane__placeholder">Loading editor…</div>}>
            <SourceEditor />
          </Suspense>
        ) : (
          <Suspense fallback={<div className="editor-pane__placeholder">Loading WYSIWYG…</div>}>
            <WysiwygEditor />
          </Suspense>
        )}
      </div>
    </main>
  )
}
