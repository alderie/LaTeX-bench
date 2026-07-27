import * as React from 'react'
import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { forEachDiagnostic } from '@codemirror/lint'
import {
  CHAR_WIDTH,
  LINE_HEIGHT,
  computeLayout,
  computeSlider,
  lineAtY,
  tokenizeLine,
  type MinimapLayout,
  type RunKind,
  type ViewportInfo
} from './minimap-model'
import { subscribeSourceUpdate } from './source-bridge'
import { useFindStore } from '../../stores/findStore'

// A scaled-down picture of the whole file down the right-hand edge, and a
// scrollbar you can aim with.
//
// On a paper the size these get to, the vertical scrollbar answers "how far
// through am I" and nothing else. The minimap answers the question you
// actually have — *where is the thing I'm looking for* — because a paper has
// a very distinctive shape at this scale: a wall of preamble, then prose,
// then the blocky rectangles of an align environment or a table.
//
// Drawn on a canvas rather than as DOM: 300 visible lines is ~1,500 rects,
// which canvas paints in well under a frame and DOM does not.

interface Props {
  view: EditorView | null
}

interface Palette {
  text: string
  macro: string
  brace: string
  comment: string
  math: string
  slider: string
  sliderActive: string
  search: string
  problem: string
  cursor: string
}

function readPalette(host: HTMLElement): Palette {
  const style = getComputedStyle(host)
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback
  return {
    text: read('--minimap-text', 'rgba(0,0,0,0.5)'),
    macro: read('--code-macro', '#4338ca'),
    brace: read('--minimap-dim', 'rgba(0,0,0,0.2)'),
    comment: read('--minimap-dim', 'rgba(0,0,0,0.2)'),
    math: read('--code-env', '#0f766e'),
    slider: read('--minimap-slider', 'rgba(0,0,0,0.07)'),
    sliderActive: read('--minimap-slider-hover', 'rgba(0,0,0,0.13)'),
    search: read('--editor-match-current', 'rgba(249,115,22,0.55)'),
    problem: read('--status-error', '#dc2626'),
    cursor: read('--editor-cursor', '#4f46e5')
  }
}

function colorFor(kind: RunKind, palette: Palette): string {
  switch (kind) {
    case 'macro':
      return palette.macro
    case 'comment':
      return palette.comment
    case 'brace':
      return palette.brace
    case 'math':
      return palette.math
    default:
      return palette.text
  }
}

/** Which document lines the editor is actually showing right now. */
function readViewport(view: EditorView, canvasHeight: number): ViewportInfo {
  const { doc } = view.state
  const scroller = view.scrollDOM
  const rect = scroller.getBoundingClientRect()
  const top = view.lineBlockAtHeight(rect.top - view.documentTop)
  const bottom = view.lineBlockAtHeight(rect.bottom - view.documentTop)
  const scrollable = scroller.scrollHeight - scroller.clientHeight
  return {
    lines: doc.lines,
    canvasHeight,
    topLine: doc.lineAt(top.from).number,
    bottomLine: doc.lineAt(bottom.from).number,
    progress: scrollable > 0 ? scroller.scrollTop / scrollable : 0
  }
}

function drawMarks(
  ctx: CanvasRenderingContext2D,
  lines: number[],
  layout: MinimapLayout,
  color: string,
  width: number
): void {
  if (!lines.length) return
  ctx.fillStyle = color
  let previous = -1
  for (const line of lines) {
    if (line === previous) continue
    previous = line
    const y = (line - 1) * LINE_HEIGHT - layout.offset
    ctx.fillRect(0, y, width, 2)
  }
}

export function SourceMinimap({ view }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef<{ grabOffset: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host || !view) return undefined

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return undefined

    let palette = readPalette(host)
    let frame = 0
    let disposed = false

    const paint = (): void => {
      frame = 0
      if (disposed) return
      const width = host.clientWidth
      const height = host.clientHeight
      if (width === 0 || height === 0) return

      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const info = readViewport(view, height)
      const layout = computeLayout(info)
      const { doc } = view.state

      // Runs batched by colour: one `fillStyle` assignment per kind rather
      // than per rect is the difference between a smooth drag and a jerky
      // one on a long file.
      const byColor = new Map<string, number[]>()
      for (let n = layout.firstLine; n <= layout.lastLine; n++) {
        const y = (n - 1) * LINE_HEIGHT - layout.offset
        if (y + LINE_HEIGHT < 0 || y > height) continue
        const line = doc.line(n)
        if (!line.text) continue
        for (const run of tokenizeLine(line.text)) {
          const color = colorFor(run.kind, palette)
          let list = byColor.get(color)
          if (!list) byColor.set(color, (list = []))
          list.push(run.from * CHAR_WIDTH, y, (run.to - run.from) * CHAR_WIDTH)
        }
      }
      for (const [color, rects] of byColor) {
        ctx.fillStyle = color
        for (let i = 0; i < rects.length; i += 3) {
          ctx.fillRect(rects[i], rects[i + 1], rects[i + 2], LINE_HEIGHT - 1)
        }
      }

      // Two things worth seeing without scrolling to them: where the
      // compiler is going to complain, and where the find query hit.
      const problems: number[] = []
      forEachDiagnostic(view.state, (diagnostic, from) => {
        if (diagnostic.severity === 'error') problems.push(doc.lineAt(from).number)
      })
      drawMarks(ctx, problems, layout, palette.problem, width)
      drawMarks(ctx, useFindStore.getState().summary.lines, layout, palette.search, width)

      // The caret's line, so you can see where you left it after scrolling
      // somewhere else.
      const caretLine = doc.lineAt(view.state.selection.main.head).number
      ctx.fillStyle = palette.cursor
      ctx.fillRect(0, (caretLine - 1) * LINE_HEIGHT - layout.offset, width, 1)

      const slider = computeSlider(info, layout)
      ctx.fillStyle = draggingRef.current ? palette.sliderActive : palette.slider
      ctx.fillRect(0, slider.top, width, Math.max(4, slider.height))
    }

    const schedule = (): void => {
      if (frame || disposed) return
      frame = requestAnimationFrame(paint)
    }

    schedule()
    const unsubscribe = subscribeSourceUpdate(schedule)
    const unsubscribeFind = useFindStore.subscribe(schedule)
    view.scrollDOM.addEventListener('scroll', schedule, { passive: true })

    const resize = new ResizeObserver(schedule)
    resize.observe(host)

    // The palette is CSS-variable driven, so a theme switch has to be
    // re-read — nothing else tells the canvas its colours changed.
    const themeObserver = new MutationObserver(() => {
      palette = readPalette(host)
      schedule()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    // ── Pointer: click to jump, drag to scrub ──────────────────────────
    const scrollToY = (clientY: number): void => {
      const rect = host.getBoundingClientRect()
      const height = rect.height
      const info = readViewport(view, height)
      const layout = computeLayout(info)
      const grab = draggingRef.current?.grabOffset ?? 0
      const line = lineAtY(clientY - rect.top - grab, layout, info.lines)
      const visible = Math.max(1, info.bottomLine - info.topLine + 1)
      // The pointer names the *top* of the viewport when dragging the slider
      // (the grab offset is preserved) and its middle when clicking
      // elsewhere, which is where the eye expects to land.
      const target = draggingRef.current ? line : Math.max(1, line - Math.floor(visible / 2))
      const pos = view.state.doc.line(Math.min(target, view.state.doc.lines)).from
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'start' })
      })
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!draggingRef.current) return
      event.preventDefault()
      scrollToY(event.clientY)
    }

    const onPointerUp = (): void => {
      draggingRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      schedule()
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      event.preventDefault()
      const rect = host.getBoundingClientRect()
      const info = readViewport(view, rect.height)
      const layout = computeLayout(info)
      const slider = computeSlider(info, layout)
      const y = event.clientY - rect.top
      const insideSlider = y >= slider.top && y <= slider.top + Math.max(4, slider.height)
      draggingRef.current = { grabOffset: insideSlider ? y - slider.top : 0 }
      scrollToY(event.clientY)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      schedule()
    }

    // Scrolling over the minimap scrolls the document, like any other
    // scrollbar-adjacent strip.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      view.scrollDOM.scrollTop += event.deltaY
    }

    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      unsubscribe()
      unsubscribeFind()
      view.scrollDOM.removeEventListener('scroll', schedule)
      resize.disconnect()
      themeObserver.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [view])

  return (
    <div className="source-minimap" ref={hostRef} aria-hidden="true">
      <canvas ref={canvasRef} className="source-minimap__canvas" />
    </div>
  )
}
