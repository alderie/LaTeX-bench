import * as React from 'react'
import { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import { usePaperStore } from '../stores/paperStore'
import { MAX_PREVIEW_WIDTH, MIN_PREVIEW_WIDTH, useUiStore } from '../stores/uiStore'
import { EditorToolbar } from './EditorToolbar'
import { OutlinePanel } from './OutlinePanel'
import { BuildPanel } from './BuildPanel'

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
// pdf.js is heavier than either editor and only some sessions open it.
const PdfPreview = lazy(() => import('./PdfPreview').then((m) => ({ default: m.PdfPreview })))

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

/**
 * The drag handle between the editor and the PDF.
 *
 * Width is tracked on a ref during the drag and only written to the store on
 * release: a zustand write per mousemove would re-render both panes sixty
 * times a second, and the PDF pane re-fits its pages when it resizes.
 */
function PreviewDivider(): React.JSX.Element {
  const setPreviewWidth = useUiStore((s) => s.setPreviewWidth)
  const dragging = useRef(false)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      dragging.current = true
      const el = event.currentTarget
      el.setPointerCapture(event.pointerId)
      document.body.classList.add('is-resizing-preview')

      const move = (e: PointerEvent): void => {
        if (!dragging.current) return
        const width = Math.min(
          MAX_PREVIEW_WIDTH,
          Math.max(MIN_PREVIEW_WIDTH, window.innerWidth - e.clientX)
        )
        document.documentElement.style.setProperty('--preview-width', `${width}px`)
      }
      const up = (e: PointerEvent): void => {
        dragging.current = false
        document.body.classList.remove('is-resizing-preview')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setPreviewWidth(window.innerWidth - e.clientX)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [setPreviewWidth]
  )

  return (
    <div
      className="preview-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the PDF preview"
      onPointerDown={onPointerDown}
    />
  )
}

export function EditorPane(): React.JSX.Element {
  const paperId = usePaperStore((s) => s.paperId)
  const viewMode = useUiStore((s) => s.viewMode)
  const previewOpen = useUiStore((s) => s.previewOpen)
  const previewWidth = useUiStore((s) => s.previewWidth)
  usePrefetchEditors()

  // The width lives in a CSS variable so the divider can move it during a
  // drag without going through React at all.
  useEffect(() => {
    document.documentElement.style.setProperty('--preview-width', `${previewWidth}px`)
  }, [previewWidth])

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
      <div className="editor-pane__split">
        <div className="editor-pane__main">
          <div className="editor-pane__body">
            <OutlinePanel />
            <div className="editor-pane__editor">
              {viewMode === 'source' ? (
                <Suspense
                  fallback={<div className="editor-pane__placeholder">Loading editor…</div>}
                >
                  <SourceEditor />
                </Suspense>
              ) : (
                <Suspense
                  fallback={<div className="editor-pane__placeholder">Loading WYSIWYG…</div>}
                >
                  <WysiwygEditor />
                </Suspense>
              )}
            </div>
          </div>
          <BuildPanel />
        </div>
        {previewOpen && (
          <>
            <PreviewDivider />
            <div className="editor-pane__preview">
              <Suspense fallback={<div className="editor-pane__placeholder">Loading preview…</div>}>
                <PdfPreview />
              </Suspense>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
