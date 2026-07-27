// Paper zoom.
//
// Zoom is applied as a CSS custom property that scales the paper's root font
// size. Everything inside the paper is sized in `em`, so one property drives
// the whole view — and unlike a CSS `transform` it keeps text crisp and the
// caret hit-testing correct.
//
// The catch is cost: changing a font size invalidates layout for the entire
// document, and a wheel gesture fires far faster than that layout can run.
// So this module separates the two halves of a zoom change:
//
//   applyZoom   — cheap, visual only, coalesced to one write per frame.
//                 Safe to call from every wheel event.
//   commitZoom  — the store write and `localStorage` persistence, which the
//                 caller debounces to the end of the gesture.

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5

/** Discrete stops used by the keyboard shortcuts. */
export const ZOOM_STOPS = [0.5, 0.67, 0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5]

export const DEFAULT_ZOOM = 1
const STORAGE_KEY = 'paperZoom'

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Round to whole percent. A wheel gesture produces a continuous stream of
 * values, and writing a new font size for a change of 0.03% is a full
 * relayout that nobody can see.
 */
export function quantizeZoom(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100) / 100
}

export function nextZoomStop(current: number, direction: 1 | -1): number {
  const stops = direction === 1 ? ZOOM_STOPS : [...ZOOM_STOPS].reverse()
  const found = stops.find((stop) =>
    direction === 1 ? stop > current + 0.001 : stop < current - 0.001
  )
  return found ?? clampZoom(current)
}

export function readStoredZoom(): number {
  return clampZoom(Number(localStorage.getItem(STORAGE_KEY)) || DEFAULT_ZOOM)
}

export function persistZoom(zoom: number): void {
  localStorage.setItem(STORAGE_KEY, String(zoom))
}

// ── Visual application ─────────────────────────────────────────────────

let pendingZoom: number | null = null
// A boolean rather than the rAF handle: the handle is only assigned *after*
// `requestAnimationFrame` returns, so a callback that runs synchronously
// (some test environments, and rAF-throttling shims) would see the stale
// value and leave the flag set forever, silently freezing every later paint.
let framePending = false
let appliedZoom = DEFAULT_ZOOM

/**
 * Set the zoom variable, coalescing to one DOM write per animation frame.
 * Repeated calls within a frame keep only the newest value, so a burst of
 * wheel events costs exactly one relayout.
 */
export function applyZoom(zoom: number): void {
  const next = quantizeZoom(zoom)
  if (next === appliedZoom && pendingZoom === null) return
  pendingZoom = next
  if (framePending) return
  framePending = true
  requestAnimationFrame(() => {
    framePending = false
    const value = pendingZoom
    pendingZoom = null
    if (value === null || value === appliedZoom) return
    appliedZoom = value
    document.documentElement.style.setProperty('--paper-zoom', String(value))
  })
}

/** The zoom currently painted, which during a gesture leads the store. */
export function currentZoom(): number {
  return pendingZoom ?? appliedZoom
}

/**
 * Apply without waiting for a frame — used at startup to avoid a visible
 * jump, and by tests. Drops any queued value: this is an explicit override,
 * so a half-finished gesture must not paint over it a frame later.
 */
export function applyZoomNow(zoom: number): void {
  pendingZoom = null
  appliedZoom = quantizeZoom(zoom)
  document.documentElement.style.setProperty('--paper-zoom', String(appliedZoom))
}
