import * as React from 'react'
import { Suspense, lazy, useEffect } from 'react'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import { EditorToolbar } from './EditorToolbar'

// CodeMirror / ProseMirror are heavy — split into their own chunks.
const loadSourceEditor = (): Promise<{
  default: typeof import('../editor/source/SourceEditor').SourceEditor
}> =>
  import('../editor/source/SourceEditor').then((m) => ({
    default: m.SourceEditor
  }))
const loadWysiwygEditor = (): Promise<{
  default: typeof import('../editor/wysiwyg/WysiwygEditor').WysiwygEditor
}> =>
  import('../editor/wysiwyg/WysiwygEditor').then((m) => ({
    default: m.WysiwygEditor
  }))

const SourceEditor = lazy(loadSourceEditor)
const WysiwygEditor = lazy(loadWysiwygEditor)

/**
 * Pull the chunk the user *isn't* looking at in behind the first paint.
 *
 * Splitting the two editors keeps the app's first frame cheap, but it moved
 * the cost to the view toggle: the first press of it downloaded, parsed, and
 * evaluated CodeMirror while the pane sat on "Loading editor…". Fetching it
 * during idle time costs nothing visible and makes the toggle instant.
 */
function usePrefetchEditors(): void {
  useEffect(() => {
    const prefetch = (): void => {
      void loadSourceEditor()
      void loadWysiwygEditor()
    }
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback
    if (idle) {
      const handle = idle(prefetch)
      return () => {
        ;(window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(handle)
      }
    }
    const timer = setTimeout(prefetch, 1200)
    return () => clearTimeout(timer)
  }, [])
}

export function EditorPane(): React.JSX.Element {
  const paperId = usePaperStore((s) => s.paperId)
  const viewMode = useUiStore((s) => s.viewMode)
  usePrefetchEditors()

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
