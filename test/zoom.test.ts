import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  applyZoom,
  applyZoomNow,
  clampZoom,
  currentZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStop,
  quantizeZoom
} from '@renderer/editor/zoom'

// Zoom changes the paper's root font size, which relayouts the whole
// document. A wheel gesture fires far faster than that layout can run, so the
// coalescing here is what separates a smooth zoom from a locked-up one.

describe('zoom arithmetic', () => {
  it('clamps to the supported range', () => {
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(1.25)).toBe(1.25)
    // A NaN from a corrupted localStorage value must not poison the view.
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('quantizes to whole percent', () => {
    // Without this a wheel event writes a new font size for a change nobody
    // can see — a full relayout for nothing.
    expect(quantizeZoom(1.00004)).toBe(1)
    expect(quantizeZoom(1.237)).toBe(1.24)
  })

  it('steps to the next discrete stop in each direction', () => {
    expect(nextZoomStop(1, 1)).toBeGreaterThan(1)
    expect(nextZoomStop(1, -1)).toBeLessThan(1)
    // At the ends, stepping further stays put rather than wrapping.
    expect(nextZoomStop(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(nextZoomStop(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('steps sensibly from a value that is not itself a stop', () => {
    // A wheel gesture leaves arbitrary values behind; the keyboard shortcut
    // still has to move somewhere sensible from there.
    expect(nextZoomStop(1.13, 1)).toBe(1.25)
    expect(nextZoomStop(1.13, -1)).toBe(1.1)
  })
})

describe('zoom application', () => {
  let frames: FrameRequestCallback[] = []

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    applyZoomNow(1)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const runFrame = (): void => {
    const queued = frames
    frames = []
    for (const cb of queued) cb(0)
  }

  const painted = (): string =>
    document.documentElement.style.getPropertyValue('--paper-zoom')

  it('applies immediately when asked to', () => {
    applyZoomNow(1.5)
    expect(painted()).toBe('1.5')
  })

  it('coalesces a burst of updates into a single DOM write', () => {
    // The whole point: 30 wheel events in one frame must cost one relayout.
    for (let i = 1; i <= 30; i++) applyZoom(1 + i / 100)
    expect(frames).toHaveLength(1)
    expect(painted()).toBe('1') // nothing written yet

    runFrame()
    expect(painted()).toBe('1.3') // only the newest value
  })

  it('reports the pending value before the frame runs', () => {
    // The gesture handler multiplies against the current zoom on every
    // event; reading the painted value instead would make the gesture stall
    // until the next frame.
    applyZoom(1.4)
    expect(currentZoom()).toBe(1.4)
    runFrame()
    expect(currentZoom()).toBe(1.4)
  })

  it('does not schedule a frame when the value is unchanged', () => {
    applyZoom(1)
    expect(frames).toHaveLength(0)
  })

  it('clamps values coming from the gesture', () => {
    applyZoom(99)
    runFrame()
    expect(Number(painted())).toBe(MAX_ZOOM)
  })
})
