import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { captureAnchor, defaultAnchor, restoreAnchor } from '@renderer/editor/zoom-anchor'

// jsdom has no layout engine, so geometry is supplied by hand. That's fine
// for what these tests are about: the arithmetic that turns "where the
// anchor was" plus "where it ended up" into a scroll correction. The visual
// claim — that the line under the cursor really does stay put — is verified
// against a real engine in scripts/check-zoom-anchor.mjs.

interface FakeBox {
  top: number
  height: number
  left?: number
  width?: number
}

/** Give an element a settable scrollTop and a controllable rect. */
function fakeGeometry(el: HTMLElement, box: FakeBox): (next: FakeBox) => void {
  let current = box
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const left = current.left ?? 0
      const width = current.width ?? 800
      return {
        top: current.top,
        bottom: current.top + current.height,
        height: current.height,
        left,
        right: left + width,
        width,
        x: left,
        y: current.top,
        toJSON: () => ({})
      } as DOMRect
    }
  })
  return (next: FakeBox) => {
    current = next
  }
}

function makeScrollable(el: HTMLElement, scrollHeight: number): void {
  let scrollTop = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    }
  })
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight
  })
}

describe('zoom anchoring', () => {
  let container: HTMLElement
  let content: HTMLElement
  let paragraph: HTMLElement
  let moveParagraph: (next: FakeBox) => void

  beforeEach(() => {
    document.body.replaceChildren()
    container = document.createElement('div')
    container.className = 'wysiwyg-editor'
    content = document.createElement('div')
    paragraph = document.createElement('p')
    content.appendChild(paragraph)
    container.appendChild(content)
    document.body.appendChild(container)

    // Viewport: the editor occupies y ∈ [100, 700].
    fakeGeometry(container, { top: 100, height: 600 })
    makeScrollable(container, 5000)
    // The paragraph the pointer is over sits at y ∈ [300, 340].
    moveParagraph = fakeGeometry(paragraph, { top: 300, height: 40 })
    vi.stubGlobal('document', document)
    document.elementFromPoint = (): Element => paragraph
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scrolls so the anchored element stays under the pointer', () => {
    const captured = captureAnchor(container, { clientX: 400, clientY: 320 })
    expect(captured).not.toBeNull()

    // Zoom grew everything above: the paragraph is now 120px lower and taller.
    moveParagraph({ top: 420, height: 56 })
    restoreAnchor(captured)

    // Anchor was halfway down the old paragraph (320 of 300..340), so it
    // should land halfway down the new one: 420 + 28 = 448, corrected back
    // to 320 → scrollTop moves by 128.
    expect(container.scrollTop).toBe(128)
  })

  it('leaves the scroll alone when nothing moved', () => {
    const captured = captureAnchor(container, { clientX: 400, clientY: 320 })
    restoreAnchor(captured)
    expect(container.scrollTop).toBe(0)
  })

  it('scrolls back up when zooming out', () => {
    const captured = captureAnchor(container, { clientX: 400, clientY: 320 })
    moveParagraph({ top: 220, height: 28 })
    restoreAnchor(captured)
    // Content shrank upward, so the correction is negative.
    expect(container.scrollTop).toBeLessThan(0)
  })

  it('clamps a pointer outside the editor onto its edge', () => {
    // The pointer is over the toolbar, above the editor. Anchoring should
    // still happen — at the top edge — rather than being skipped.
    const captured = captureAnchor(container, { clientX: 400, clientY: 20 })
    expect(captured).not.toBeNull()
    expect(captured!.viewportOffset).toBe(0)
  })

  it('falls back to proportional scrolling when the element is gone', () => {
    const captured = captureAnchor(container, { clientX: 400, clientY: 320 })
    container.scrollTop = 1000
    // Simulate the node view replacing its DOM between frames.
    paragraph.remove()
    restoreAnchor(captured)
    // No exception, and the scroll landed somewhere inside the document.
    expect(container.scrollTop).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(container.scrollTop)).toBe(true)
  })

  it('anchors on the caret when no pointer is given', () => {
    const range = {
      getBoundingClientRect: () => ({ top: 380, bottom: 400, height: 20, left: 250, width: 2 })
    }
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => range
    } as unknown as Selection)

    const anchor = defaultAnchor(container)
    // The caret is where the author is working — that's the right pivot for
    // a keyboard zoom.
    expect(anchor.clientY).toBe(390)
  })

  it('falls back to the viewport centre when the caret is off screen', () => {
    const range = {
      getBoundingClientRect: () => ({ top: 2000, bottom: 2020, height: 20, left: 250, width: 2 })
    }
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => range
    } as unknown as Selection)

    const anchor = defaultAnchor(container)
    expect(anchor.clientY).toBe(400) // 100 + 600/2
  })

  it('falls back to the viewport centre with no selection at all', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null)
    expect(defaultAnchor(container).clientY).toBe(400)
  })
})
