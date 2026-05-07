import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { usePaperStore } from '../stores/paperStore'

// pdfjs-dist worker setup. Vite serves the worker URL; we load the module
// dynamically so the heavy library lands in its own chunk.
async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  const mod = await import('pdfjs-dist')
  // The worker is shipped as a separate file; using ?url tells Vite to
  // copy it into the build output and return its URL.
  if (!mod.GlobalWorkerOptions.workerSrc) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    mod.GlobalWorkerOptions.workerSrc = workerUrl
  }
  return mod
}

interface PdfRendererProps {
  paperId: string
  pdfPath: string
}

export function PdfRenderer({ paperId, pdfPath }: PdfRendererProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Track which build we last rendered so re-renders after a successful
  // compile show the new PDF without page-flicker on every state change.
  const lastBuiltAt = usePaperStore((s) => s.build.durationMs)

  useEffect(() => {
    let cancelled = false
    const host = containerRef.current
    if (!host) return undefined
    setError(null)

    void (async () => {
      try {
        const pdfjs = await getPdfjs()
        const data = await window.latexAPI.readPdf(paperId)
        if (!data) {
          setError('No PDF available — build the paper first.')
          return
        }
        if (cancelled) return

        const loadingTask = pdfjs.getDocument({ data: data.slice() })
        const doc = await loadingTask.promise
        if (cancelled) return

        // Wipe any previously rendered pages.
        host.replaceChildren()

        const containerWidth = host.clientWidth - 32 // body padding

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: 1 })
          const scale = Math.max(0.5, containerWidth / viewport.width)
          const scaled = page.getViewport({ scale })

          const canvas = document.createElement('canvas')
          canvas.className = 'preview-pane__page'
          const ctx = canvas.getContext('2d')!
          const dpr = window.devicePixelRatio || 1
          canvas.width = scaled.width * dpr
          canvas.height = scaled.height * dpr
          canvas.style.width = `${scaled.width}px`
          canvas.style.height = `${scaled.height}px`
          ctx.scale(dpr, dpr)

          host.appendChild(canvas)
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport: scaled
          }).promise
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
    // Re-render when the paper id, the underlying build, OR the PDF path
    // changes (the path is stable across rebuilds, but durationMs changes
    // on every successful build, so it acts as a "build version" key).
  }, [paperId, pdfPath, lastBuiltAt])

  return (
    <>
      {error && <div className="preview-pane__error">{error}</div>}
      <div ref={containerRef} className="pdf-renderer" />
    </>
  )
}
