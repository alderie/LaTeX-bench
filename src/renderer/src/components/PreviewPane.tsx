import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useUiStore } from '../stores/uiStore'
import { usePaperStore } from '../stores/paperStore'
import { PdfRenderer } from './PdfRenderer'
import type { BuildError, BuildState } from '@shared/types'

const STORAGE_KEY = 'previewPaneWidth'
const CSS_VAR = '--preview-width'
const DEFAULT_WIDTH = 480
const MIN_WIDTH = 320

function clampWidth(w: number): number {
  const max = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7))
  return Math.min(max, Math.max(MIN_WIDTH, w))
}

function readStoredWidth(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? parseInt(raw, 10) : NaN
  const initial = Number.isFinite(parsed) && parsed >= MIN_WIDTH ? parsed : DEFAULT_WIDTH
  return clampWidth(initial)
}

export function PreviewPane(): React.JSX.Element {
  const previewFullscreen = useUiStore((s) => s.previewFullscreen)
  const buildState = usePaperStore((s) => s.build.state)
  const buildErrors = usePaperStore((s) => s.build.errors)
  const buildDuration = usePaperStore((s) => s.build.durationMs)

  const dragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)

  useEffect(() => {
    document.documentElement.style.setProperty(CSS_VAR, `${readStoredWidth()}px`)
    const onResize = (): void => {
      const current = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(CSS_VAR) || '0',
        10
      )
      const next = clampWidth(current || DEFAULT_WIDTH)
      document.documentElement.style.setProperty(CSS_VAR, `${next}px`)
      localStorage.setItem(STORAGE_KEY, String(next))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (previewFullscreen) return
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      const current = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(CSS_VAR) || `${DEFAULT_WIDTH}`,
        10
      )
      dragRef.current = { startX: e.clientX, startWidth: current, currentWidth: current }
      document.body.classList.add('preview-pane-resizing')
    },
    [previewFullscreen]
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const next = clampWidth(drag.startWidth + (drag.startX - e.clientX))
    if (next === drag.currentWidth) return
    drag.currentWidth = next
    document.documentElement.style.setProperty(CSS_VAR, `${next}px`)
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    localStorage.setItem(STORAGE_KEY, String(drag.currentWidth))
    dragRef.current = null
    document.body.classList.remove('preview-pane-resizing')
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  return (
    <section className="preview-pane">
      {!previewFullscreen && (
        <div
          className="preview-pane__resize-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <div className="preview-pane__header">
        <span className="preview-pane__title">PDF preview</span>
      </div>
      <PreviewBody />
      <BuildStatusBar state={buildState} errors={buildErrors} durationMs={buildDuration} />
    </section>
  )
}

function PreviewBody(): React.JSX.Element {
  const paperId = usePaperStore((s) => s.paperId)
  const pdfPath = usePaperStore((s) => s.build.pdfPath)
  const buildState = usePaperStore((s) => s.build.state)
  const errors = usePaperStore((s) => s.build.errors)

  if (!paperId) {
    return (
      <div className="preview-pane__body">
        <div className="preview-pane__placeholder">Select a paper to preview.</div>
      </div>
    )
  }
  if (buildState === 'error' && !pdfPath && errors.length > 0) {
    return (
      <div className="preview-pane__body">
        <div className="preview-pane__error">
          {errors.slice(0, 5).map((e) => `${e.severity.toUpperCase()}: ${e.message}`).join('\n')}
        </div>
      </div>
    )
  }
  if (!pdfPath) {
    return (
      <div className="preview-pane__body">
        <div className="preview-pane__placeholder">
          Build the paper to see the rendered PDF here.
        </div>
      </div>
    )
  }
  return (
    <div className="preview-pane__body">
      <PdfRenderer paperId={paperId} pdfPath={pdfPath} />
    </div>
  )
}

function BuildStatusBar({
  state,
  errors,
  durationMs
}: {
  state: BuildState
  errors: BuildError[]
  durationMs: number
}): React.JSX.Element {
  const errCount = errors.filter((e) => e.severity === 'error').length
  const warnCount = errors.filter((e) => e.severity === 'warning').length
  let label: string
  let cls = 'status-pill'
  if (state === 'running') label = 'Compiling…'
  else if (state === 'success') {
    label = `Compiled in ${(durationMs / 1000).toFixed(1)}s${warnCount ? ` · ${warnCount} warn` : ''}`
    cls += ' status-pill--ok'
  } else if (state === 'error') {
    label = `${errCount} error${errCount === 1 ? '' : 's'}${warnCount ? ` · ${warnCount} warn` : ''}`
    cls += ' status-pill--err'
  } else {
    label = 'Idle'
  }
  return (
    <div className="preview-pane__build-status">
      <span className={cls}>
        <span className="status-pill__dot" />
        {label}
      </span>
    </div>
  )
}

export default PreviewPane
