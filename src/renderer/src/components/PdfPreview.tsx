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

/** The wheel gesture is continuous, so it needs bounds rather than stops. */
const MIN_PDF_ZOOM = 0.25
const MAX_PDF_ZOOM = 6
/** How much of a wheel notch is one doubling. Matches the paper's gesture. */
const WHEEL_SENSITIVITY = 0.0015
/** How long the wheel has to stop before the pages are re-rasterised. */
const RERENDER_DELAY_MS = 160

/**
 * Resize every rendered page to `zoom`, in CSS only.
 *
 * The canvas keeps whatever pixels it was rasterised with; this just scales
 * the box they're painted into, which the compositor does for free. Both
 * dimensions come from the page's own size at scale 1, so the ratio is
 * exactly the PDF's however far the zoom has drifted from the last render.
 */
function applyCssZoom(host: HTMLElement | null, zoom: number): void {
  if (!host) return
  for (const canvas of Array.from(host.querySelectorAll('canvas'))) {
    const baseWidth = Number(canvas.dataset.baseWidth)
    const baseHeight = Number(canvas.dataset.baseHeight)
    if (!baseWidth || !baseHeight) continue
    canvas.style.width = `${Math.round(baseWidth * zoom)}px`
    canvas.style.height = `${Math.round(baseHeight * zoom)}px`
  }
}

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

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsModule: Promise<Pdfjs> | null = null

/**
 * Load pdf.js once, and point it at its worker.
 *
 * The *legacy* build, deliberately. pdf.js's default build targets the
 * newest browsers and calls `Map.prototype.getOrInsertComputed`, which the
 * Chromium in Electron 39 does not have — so the modern build parses the
 * document, reports the right page count, and then throws inside every
 * `render()` call, leaving a correctly-sized blank canvas and no error
 * anywhere the user can see. The legacy bundle is the same library
 * transpiled for engines that lack those methods.
 *
 * The worker has to be a real URL Vite has emitted, not a bare specifier —
 * pdf.js fetches it at runtime, so a module path that only the bundler
 * understands resolves to a 404 and every render silently falls back to the
 * main thread.
 */
function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsModule) {
    pdfjsModule = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
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
  // A rebuild landing on a preview that already shows something. Distinct
  // from `loading`, which is the state where there is nothing to look at.
  const [refreshing, setRefreshing] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pagesRef = useRef<HTMLDivElement | null>(null)
  // The live zoom during a wheel gesture, which runs ahead of React.
  const zoomRef = useRef(1)
  // Whether there are pages on screen right now. A rebuild is a very
  // different event depending on the answer — see the load effect.
  const paintedRef = useRef(false)

  // A different paper has nothing in common with what is on screen, so the
  // next build genuinely is a first load. Declared before the loader so it
  // runs first when `paperId` changes.
  useEffect(() => {
    paintedRef.current = false
  }, [paperId])

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
      // Only blank the pane when there is nothing to blank. A rebuild used to
      // take the same path as opening the app: pages hidden, grey panel, "
      // Loading the PDF…", then the document back — three states in a few
      // hundred milliseconds, for a change that is usually one word in one
      // paragraph. When something is already drawn it stays drawn, dimmed,
      // until the replacement is ready to swap in whole.
      if (paintedRef.current) setRefreshing(true)
      else setStatus('loading')
      try {
        const bytes = await window.latexAPI.readPdf(paperId)
        if (cancelled) return
        if (!bytes || bytes.length === 0) {
          setStatus('empty')
          setRefreshing(false)
          paintedRef.current = false
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
        setRefreshing(false)
        paintedRef.current = false
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

    // Where the new pages are built. When the pane is already showing a
    // document — a rebuild, a zoom step — they are built off-screen and
    // swapped in together at the end, so the reader never sees the blank
    // canvases fill in one at a time. On a first load there is nothing to
    // protect, and appending as we go means page one appears immediately
    // instead of after the last page of a long paper.
    const swap = paintedRef.current && host.childElementCount > 0

    const draw = async (): Promise<void> => {
      const available = scrollRef.current?.clientWidth ?? 600
      const target: Node & ParentNode = swap ? document.createDocumentFragment() : host
      if (!swap) host.replaceChildren()

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
        // The page's shape at scale 1, so the wheel gesture can resize the
        // canvas between rasterisations without recomputing a viewport —
        // and, critically, can set *both* dimensions together. Setting only
        // one and letting CSS decide the other is what squashes the page.
        canvas.dataset.baseWidth = String(unscaled.width)
        canvas.dataset.baseHeight = String(unscaled.height)
        wrapper.appendChild(canvas)
        target.appendChild(wrapper)
        // What is actually on screen, which in fit-width is a number nobody
        // chose. A wheel gesture and the +/- buttons both start from here.
        if (n === 1) zoomRef.current = scale

        const context = canvas.getContext('2d')
        if (!context) continue
        context.scale(ratio, ratio)
        const task = page.render({ canvasContext: context, viewport })
        tasks.push(task)
        try {
          await task.promise
        } catch (err) {
          // A cancelled render is the normal outcome of a rebuild landing
          // mid-paint. Anything else means the page did not draw, and a
          // silent catch here is what let a library incompatibility present
          // itself as a correctly-sized blank sheet with the right page
          // count — so everything except a cancellation is reported.
          if ((err as Error).name === 'RenderingCancelledException') return
          if (cancelled) return
          setStatus('error')
          setError(`Page ${n} failed to render: ${(err as Error).message}`)
          return
        }
        // From the moment page one is on screen there is something worth not
        // flashing, even if the paper has forty more pages to go.
        if (!swap) paintedRef.current = true
      }

      if (cancelled) return
      if (swap) {
        // Replacing the content resets the scroll when the new document is
        // shorter, and "my place in the paper jumped on every save" is the
        // same complaint as the flash, one layer down.
        const scroller = scrollRef.current
        const top = scroller?.scrollTop ?? 0
        const left = scroller?.scrollLeft ?? 0
        host.replaceChildren(target)
        if (scroller) {
          scroller.scrollTop = top
          scroller.scrollLeft = left
        }
      }
      paintedRef.current = host.childElementCount > 0
    }

    // In a `finally`, because every early return above — a page that would
    // not load, a render that threw, a rebuild that landed mid-paint — is a
    // path out of `draw`, and missing one of them leaves the pane dimmed for
    // good with no way back.
    void draw().finally(() => {
      if (!cancelled) setRefreshing(false)
    })

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
    // From what is on screen, not from the last value a button set: after a
    // wheel gesture or in fit-width those are different numbers, and
    // stepping from the stale one makes the first click jump.
    const current = zoomRef.current
    const index = ZOOM_STOPS.findIndex((stop) => stop > current + 0.001)
    const next =
      direction === 1
        ? (ZOOM_STOPS[index] ?? ZOOM_STOPS[ZOOM_STOPS.length - 1])
        : ([...ZOOM_STOPS].reverse().find((stop) => stop < current - 0.001) ?? ZOOM_STOPS[0])
    zoomRef.current = next
    // Resize what is on screen now, the way the wheel gesture does. The
    // re-render at the new scale is what makes it sharp, but it takes a
    // moment, and a button that does nothing for that moment reads as broken.
    applyCssZoom(pagesRef.current, next)
    setFitWidth(false)
    setZoom(next)
  }

  // ── Ctrl/Cmd + wheel, over the PDF only ─────────────────────────────
  //
  // The app already zooms the *paper* on Ctrl+wheel, from a listener on
  // `window`. Over this pane that is the wrong document to zoom, so the
  // gesture is claimed here and stopped before it bubbles up to that one.
  //
  // Between rasterisations the canvases are resized in CSS, which is
  // instant and keeps the gesture at pointer speed; a re-render at the new
  // scale follows once the wheel stops, which is what makes it sharp again.
  // Both canvas dimensions are always written together — setting width and
  // letting `max-width` decide the height is exactly what squashed the page.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return undefined

    let settle: ReturnType<typeof setTimeout> | null = null

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      // Ours, not the paper's and not Chromium's.
      event.preventDefault()
      event.stopPropagation()

      const delta =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * 400
            : event.deltaY
      if (delta === 0) return

      const previous = zoomRef.current
      // Multiplicative, so a notch feels the same size at 50% as at 300%.
      const next = Math.min(
        MAX_PDF_ZOOM,
        Math.max(MIN_PDF_ZOOM, previous * Math.exp(-delta * WHEEL_SENSITIVITY))
      )
      if (next === previous) return
      zoomRef.current = next

      // Keep the point under the cursor under the cursor.
      const rect = scroller.getBoundingClientRect()
      const anchorX = scroller.scrollLeft + (event.clientX - rect.left)
      const anchorY = scroller.scrollTop + (event.clientY - rect.top)
      const growth = next / previous

      applyCssZoom(pagesRef.current, next)
      scroller.scrollLeft = anchorX * growth - (event.clientX - rect.left)
      scroller.scrollTop = anchorY * growth - (event.clientY - rect.top)

      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        settle = null
        setFitWidth(false)
        setZoom(zoomRef.current)
      }, RERENDER_DELAY_MS)
    }

    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      if (settle) clearTimeout(settle)
    }
  }, [])

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
        <div
          className={
            'pdf-preview__pages-host' + (refreshing ? ' pdf-preview__pages-host--refreshing' : '')
          }
          ref={pagesRef}
          hidden={status !== 'ready'}
        />
      </div>
    </div>
  )
}
