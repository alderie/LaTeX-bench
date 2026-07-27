import { useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'
import { applyZoom, clampZoom, currentZoom, MAX_ZOOM, MIN_ZOOM } from '../editor/zoom'

// Ctrl/Cmd + wheel to zoom the paper.
//
// Three things make this fast enough to feel like a native zoom:
//
//  1. The listener is non-passive and calls `preventDefault`, which stops
//     Chromium's own browser-zoom from firing. Two zooms fighting over the
//     same gesture is what makes this feel broken rather than merely slow.
//  2. The wheel handler never touches React or `localStorage`. It only calls
//     `applyZoom`, which coalesces to one CSS write per animation frame, so
//     a 120 Hz trackpad still causes at most 60 relayouts per second.
//  3. The zustand store — and therefore any component that re-renders on
//     zoom — is updated once, after the gesture stops.
//
// Attached to the window rather than the editor element so the gesture works
// over the whole paper surface including its margins.

/** How much of a wheel notch equals one doubling. Tuned to feel like Chrome. */
const WHEEL_SENSITIVITY = 0.0015

/** Trackpads report pixel deltas; a mouse wheel reports lines or pages. */
function normalizeDelta(event: WheelEvent): number {
  switch (event.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return event.deltaY * 16
    case 2: // DOM_DELTA_PAGE
      return event.deltaY * 400
    default:
      return event.deltaY
  }
}

const COMMIT_DELAY_MS = 220

export function useZoomGesture(): void {
  useEffect(() => {
    let commitTimer: ReturnType<typeof setTimeout> | null = null

    const commit = (): void => {
      commitTimer = null
      // `setZoom` re-applies the same value, which `applyZoom` no-ops on.
      useUiStore.getState().setZoom(currentZoom())
    }

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      // Claim the gesture before the browser zooms the whole UI chrome.
      event.preventDefault()

      const delta = normalizeDelta(event)
      if (delta === 0) return

      // Multiplicative, so a step feels the same size at 50% as at 200%.
      // Scrolling up (negative delta) zooms in.
      const factor = Math.exp(-delta * WHEEL_SENSITIVITY)
      const next = clampZoom(currentZoom() * factor)
      // At the limits there's nothing to paint, but the gesture is still
      // ours — returning early here would let the browser zoom instead.
      if (
        (next === MIN_ZOOM && currentZoom() === MIN_ZOOM) ||
        (next === MAX_ZOOM && currentZoom() === MAX_ZOOM)
      ) {
        return
      }
      applyZoom(next)

      if (commitTimer !== null) clearTimeout(commitTimer)
      commitTimer = setTimeout(commit, COMMIT_DELAY_MS)
    }

    // `passive: false` is required: a passive listener may not call
    // preventDefault, and Chromium treats wheel listeners as passive by
    // default on window.
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (commitTimer !== null) {
        clearTimeout(commitTimer)
        commit()
      }
    }
  }, [])
}
