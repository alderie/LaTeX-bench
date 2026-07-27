import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, FileText, Loader2, Maximize2, Minus, Plus } from 'lucide-react'
import { usePaperStore } from '../stores/paperStore'

// The document, as the compiler produced it.
//
// This is a LaTeX editor whose whole premise is a typeset document, and
// until now it could not show you one: `build.pdfPath` was set on every
// successful compile and read by nothing. The rich view is an approximation
// of the page — a good one, but the thing you check before you send a paper
// out is the page itself.
//
// Rendered with pdf.js into one canvas per page, re-rendered when a build
// lands. The bytes come over IPC rather than through the `paper://` protocol
// because a rebuild writes the same path every time, and every layer between
// here and the disk would happily serve the previous PDF from cache.

/** Zoom stops, in the order the +/- buttons walk them. */
const ZOOM_STOPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 3]

type Status = 'empty' | 'loading' | 'ready' | 'error'

interface Loaded {
  /** pdf.js document proxy — kept opaque; only pages and count are used. */
  doc: PdfDocument
  pages: number
}

// Minimal structural types. Importing pdf.js's own would pull the module
// into the graph at load time, which is exactly what the dynamic import
// below is avoiding.
interface PdfViewport {
  width: number
  height: number
}
interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
    promise: Promise<void>
    cancel(): void
  }
  cleanup(): void
}
interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
  destroy(): Promise<void>
}

let pdfjsModule: Promise<typeof import('pdfjs-dist')> | null = null

/**
 * Load pdf.js once, and point it at its worker.
 *
 * The worker has to be a real URL Vite has emitted, not a bare specifier —
 * pdf.js fetches it at runtime, so a module path that only the bundler
 * understands resolves to a 404 and every render silently falls back to the
 * main thread.
 */
function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsModule) {
    pdfjsModule = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsModule
}

export function PdfPreview(): React.JSX.Element {
  const paperId = usePaperStore((s) => s.paperId)
  const buildState = usePaperStore((s) => s.build.state)
  const revision = usePaperStore((s) => s.build.revision)
  const pdfPath = usePaperStore((s) => s.build.pdfPath)

  const [status, setStatus] = useState<Status>('empty')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  const [visiblePage, setVisiblePage] = useState(1)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pagesRef = useRef<HTMLDivElement | null>(null)

  // ── Load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!paperId) {
      setStatus('empty')
      setLoaded(null)
      return undefined
    }
    let cancelled = false
    let opened: PdfDocument | null = null

    void (async () => {
      setStatus('loading')
      try {
        const bytes = await window.latexAPI.readPdf(paperId)
        if (cancelled) return
        if (!bytes || bytes.length === 0) {
          setStatus('empty')
          setLoaded(null)
          return
        }
        const pdfjs = await loadPdfjs()
        if (cancelled) return
        // pdf.js takes ownership of the buffer it's handed, so it gets a
        // copy — the IPC result is also what a retry would re-read.
        const doc = (await pdfjs.getDocument({ data: new Uint8Array(bytes) })
          .promise) as unknown as PdfDocument
        if (cancelled) {
          void doc.destroy()
          return
        }
        opened = doc
        setLoaded({ doc, pages: doc.numPages })
        setStatus('ready')
        setError('')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError((err as Error).message)
      }
    })()

    return () => {
      cancelled = true
      if (opened) void opened.destroy()
    }
  }, [paperId, revision, pdfPath])

  // ── Render ──────────────────────────────────────────────────────────
  //
  // Every page, into its own canvas. A paper is tens of pages, not hundreds,
  // and rendering them all up front means scrolling is scrolling rather than
  // a sequence of blank rectangles filling in behind you.
  useEffect(() => {
    const host = pagesRef.current
    if (!loaded || !host) return undefined

    let cancelled = false
    const tasks: Array<{ cancel(): void }> = []

    void (async () => {
      const available = scrollRef.current?.clientWidth ?? 600
      host.replaceChildren()

      for (let n = 1; n <= loaded.pages; n++) {
        if (cancelled) return
        let page: PdfPage
        try {
          page = await loaded.doc.getPage(n)
        } catch {
          return
        }
        if (cancelled) return

        const unscaled = page.getViewport({ scale: 1 })
        // "Fit width" is the default because a preview you have to scroll
        // sideways to read is not one.
        const scale = fitWidth ? Math.max(0.1, (available - 24) / unscaled.width) : zoom
        const viewport = page.getViewport({ scale })
        // Render at device resolution and scale down in CSS, or the text is
        // soft on every display made in the last decade.
        const ratio = Math.min(3, window.devicePixelRatio || 1)

        const wrapper = document.createElement('div')
        wrapper.className = 'pdf-preview__page'
        wrapper.dataset.page = String(n)
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        wrapper.appendChild(canvas)
        host.appendChild(wrapper)

        const context = canvas.getContext('2d')
        if (!context) continue
        context.scale(ratio, ratio)
        const task = page.render({ canvasContext: context, viewport })
        tasks.push(task)
        try {
          await task.promise
        } catch {
          // A cancelled render is the normal outcome of a rebuild landing
          // mid-paint, not a failure worth surfacing.
        }
      }
    })()

    return () => {
      cancelled = true
      for (const task of tasks) {
        try {
          task.cancel()
        } catch {
          // already finished
        }
      }
    }
  }, [loaded, zoom, fitWidth])

  // Re-fit when the pane is dragged wider or narrower.
  useEffect(() => {
    if (!fitWidth) return undefined
    const el = scrollRef.current
    if (!el) return undefined
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastWidth = el.clientWidth
    const observer = new ResizeObserver(() => {
      // Re-rendering every page on every pixel of a drag would make the
      // divider feel like it was dragging the PDF, not the pane. The width
      // threshold also breaks the loop where a re-render changes the content
      // height, the scrollbar appears, and the container is a few pixels
      // narrower — which would otherwise re-render forever.
      const width = el.clientWidth
      if (Math.abs(width - lastWidth) < 12) return
      lastWidth = width
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setLoaded((cur) => (cur ? { ...cur } : cur)), 180)
    })
    observer.observe(el)
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect()
    }
  }, [fitWidth])

  // Which page you're looking at, for the counter.
  const onScroll = useCallback((): void => {
    const scroller = scrollRef.current
    const host = pagesRef.current
    if (!scroller || !host) return
    const middle = scroller.scrollTop + scroller.clientHeight / 2
    let current = 1
    for (const child of Array.from(host.children) as HTMLElement[]) {
      if (child.offsetTop <= middle) current = Number(child.dataset.page ?? current)
      else break
    }
    setVisiblePage(current)
  }, [])

  const stepZoom = (direction: 1 | -1): void => {
    setFitWidth(false)
    setZoom((current) => {
      const index = ZOOM_STOPS.findIndex((s) => s >= current - 0.001)
      const next = Math.min(
        ZOOM_STOPS.length - 1,
        Math.max(0, (index < 0 ? ZOOM_STOPS.length - 1 : index) + direction)
      )
      return ZOOM_STOPS[next]
    })
  }

  return (
    <div className="pdf-preview">
      <div className="pdf-preview__toolbar">
        {status === 'ready' && loaded ? (
          <span className="pdf-preview__pages">
            Page {visiblePage} of {loaded.pages}
          </span>
        ) : (
          <span className="pdf-preview__pages">PDF</span>
        )}
        {buildState === 'running' && (
          <Loader2 size={12} className="pdf-preview__spin" aria-label="Compiling" />
        )}
        <span className="pdf-preview__spacer" />
        <button
          className="pdf-preview__button"
          title="Zoom out"
          onClick={() => stepZoom(-1)}
          disabled={status !== 'ready'}
        >
          <Minus size={13} />
        </button>
        <button
          className={'pdf-preview__button' + (fitWidth ? ' pdf-preview__button--on' : '')}
          title="Fit to width"
          aria-pressed={fitWidth}
          onClick={() => setFitWidth((v) => !v)}
          disabled={status !== 'ready'}
        >
          <Maximize2 size={13} />
        </button>
        <button
          className="pdf-preview__button"
          title="Zoom in"
          onClick={() => stepZoom(1)}
          disabled={status !== 'ready'}
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="pdf-preview__scroll" ref={scrollRef} onScroll={onScroll}>
        {status === 'loading' && (
          <div className="pdf-preview__message">
            <Loader2 size={18} className="pdf-preview__spin" />
            <span>Loading the PDF…</span>
          </div>
        )}
        {status === 'empty' && (
          <div className="pdf-preview__message">
            <FileText size={20} strokeWidth={1.25} />
            <span>
              {buildState === 'running' ? 'Compiling…' : 'No PDF yet — press Ctrl/Cmd B to build.'}
            </span>
          </div>
        )}
        {status === 'error' && (
          <div className="pdf-preview__message pdf-preview__message--error">
            <AlertCircle size={18} />
            <span>Couldn’t open the PDF.</span>
            <span className="pdf-preview__error-detail">{error}</span>
          </div>
        )}
        <div className="pdf-preview__pages-host" ref={pagesRef} hidden={status !== 'ready'} />
      </div>
    </div>
  )
}
