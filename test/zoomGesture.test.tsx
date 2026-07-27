import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useZoomGesture } from '@renderer/hooks/useZoomGesture'
import { applyZoomNow, currentZoom, MAX_ZOOM } from '@renderer/editor/zoom'
import { useUiStore } from '@renderer/stores/uiStore'

// Ctrl+wheel has to beat the browser to the gesture and stay off the React
// render path, or zooming a long paper stutters.

function wheel(init: Partial<WheelEventInit> & { ctrlKey?: boolean }): WheelEvent {
  const event = new window.WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: 0,
    ...init
  })
  window.dispatchEvent(event)
  return event
}

describe('ctrl+wheel zoom gesture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    applyZoomNow(1)
    useUiStore.getState().setZoom(1)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ignores a plain wheel so the page still scrolls', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    const event = wheel({ deltaY: -100 })
    expect(event.defaultPrevented).toBe(false)
    expect(currentZoom()).toBe(1)
    unmount()
  })

  it('claims the gesture from the browser when ctrl is held', () => {
    // Without preventDefault, Chromium zooms the entire UI chrome at the
    // same time — two zooms fighting over one gesture.
    const { unmount } = renderHook(() => useZoomGesture())
    const event = wheel({ deltaY: -100, ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    unmount()
  })

  it('zooms in on scroll up and out on scroll down', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    wheel({ deltaY: -200, ctrlKey: true })
    expect(currentZoom()).toBeGreaterThan(1)
    const zoomedIn = currentZoom()

    wheel({ deltaY: 400, ctrlKey: true })
    expect(currentZoom()).toBeLessThan(zoomedIn)
    unmount()
  })

  it('treats cmd+wheel the same as ctrl+wheel', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    wheel({ deltaY: -200, metaKey: true })
    expect(currentZoom()).toBeGreaterThan(1)
    unmount()
  })

  it('does not write the store during the gesture, only after it settles', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    for (let i = 0; i < 20; i++) wheel({ deltaY: -40, ctrlKey: true })

    // The paint has moved; the persisted state has deliberately not.
    expect(currentZoom()).toBeGreaterThan(1)
    expect(useUiStore.getState().zoom).toBe(1)

    vi.advanceTimersByTime(300)
    expect(useUiStore.getState().zoom).toBe(currentZoom())
    unmount()
  })

  it('scales line-mode deltas so a mouse wheel is not glacial', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    wheel({ deltaY: -3, deltaMode: 1, ctrlKey: true })
    const byLines = currentZoom()

    applyZoomNow(1)
    wheel({ deltaY: -3, deltaMode: 0, ctrlKey: true })
    const byPixels = currentZoom()

    expect(byLines).toBeGreaterThan(byPixels)
    unmount()
  })

  it('stops at the maximum instead of running away', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    for (let i = 0; i < 200; i++) wheel({ deltaY: -120, ctrlKey: true })
    expect(currentZoom()).toBe(MAX_ZOOM)
    unmount()
  })

  it('commits a pending zoom when unmounted mid-gesture', () => {
    const { unmount } = renderHook(() => useZoomGesture())
    wheel({ deltaY: -200, ctrlKey: true })
    const painted = currentZoom()
    expect(useUiStore.getState().zoom).toBe(1)

    unmount()
    // Switching views mid-gesture must not silently discard the zoom.
    expect(useUiStore.getState().zoom).toBe(painted)
  })
})
