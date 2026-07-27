// Keeping the reader's place while the paper is zoomed.
//
// Zoom changes the paper's root font size, which changes the height of
// everything above the viewport as well as inside it. With `scrollTop` left
// alone the document appears to slide out from under the pointer — the
// further down the paper you are, the further it jumps.
//
// Extrapolating from the zoom ratio isn't good enough here. The paper's
// measure is `86ch`, which scales with the font size, but its top padding is
// a fixed `96px` and the bottom padding is `40vh`, so total height is not
// proportional to zoom. Anything derived purely from the ratio drifts, and
// the drift is worst exactly where it's most visible: deep in a long paper.
//
// So we measure instead. Pick a real element under the anchor point, note
// where it sits, let the zoom apply, then look at where it *actually* landed
// and correct `scrollTop` by the difference. That is exact regardless of how
// the layout responded, including reflow.

/** Point the zoom should pivot around, in client coordinates. */
export interface AnchorPoint {
  clientX: number
  clientY: number
}

interface CapturedAnchor {
  container: HTMLElement
  element: Element
  /** Where the anchor sat inside the element, as a fraction of its height. */
  withinRatio: number
  /** Where the anchor sat inside the viewport, measured from container top. */
  viewportOffset: number
  /** Container top in client space; used to convert back after the zoom. */
  containerTop: number
  /** Fallbacks for when the element is gone or has no box after the zoom. */
  scrollTop: number
  scrollHeight: number
}

export const SCROLL_CONTAINER_SELECTOR = '.wysiwyg-editor'

export function findScrollContainer(root: Document | HTMLElement = document): HTMLElement | null {
  return root.querySelector(SCROLL_CONTAINER_SELECTOR)
}

/**
 * Where to pivot when the zoom didn't come from a pointer — a keyboard
 * shortcut or the toolbar. The caret is where the author is working, so it's
 * the right pivot; with no caret in view we fall back to the middle of the
 * viewport, which is where the eye is.
 */
export function defaultAnchor(container: HTMLElement): AnchorPoint {
  const rect = container.getBoundingClientRect()
  const centre = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }

  const selection = window.getSelection?.()
  if (!selection || selection.rangeCount === 0) return centre
  const caret = selection.getRangeAt(0).getBoundingClientRect()
  // A collapsed range in an empty block reports an all-zero rect; and a
  // caret scrolled out of view is not what the reader is looking at.
  if (caret.width === 0 && caret.height === 0) return centre
  if (caret.bottom < rect.top || caret.top > rect.bottom) return centre
  return { clientX: caret.left, clientY: caret.top + caret.height / 2 }
}

/**
 * Record where the anchor point currently sits. Must be called *before* the
 * zoom is written, while the DOM still has its pre-zoom geometry.
 */
export function captureAnchor(
  container: HTMLElement,
  point: AnchorPoint | null
): CapturedAnchor | null {
  const containerRect = container.getBoundingClientRect()
  const anchor = point ?? defaultAnchor(container)

  // A pointer over the toolbar or outside the paper still deserves a sane
  // pivot: clamp it onto the visible edge rather than ignoring it.
  const clientY = Math.min(
    containerRect.bottom,
    Math.max(containerRect.top, anchor.clientY)
  )
  const clientX = Math.min(containerRect.right, Math.max(containerRect.left, anchor.clientX))

  const element = elementAt(container, clientX, clientY)
  if (!element) return null

  const rect = element.getBoundingClientRect()
  const withinRatio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0

  return {
    container,
    element,
    withinRatio: Math.min(1, Math.max(0, withinRatio)),
    viewportOffset: clientY - containerRect.top,
    containerTop: containerRect.top,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight
  }
}

/**
 * Put the anchor point back where it was. Called *after* the zoom is
 * written; reading a rect here forces the layout the browser was going to
 * perform anyway, so this costs no extra reflow.
 */
export function restoreAnchor(captured: CapturedAnchor | null): void {
  if (!captured) return
  const { container, element, withinRatio, viewportOffset, containerTop } = captured

  if (element.isConnected) {
    const rect = element.getBoundingClientRect()
    // An element inside a `content-visibility: auto` subtree that got
    // skipped reports a zero box; fall through to the proportional path
    // rather than scrolling to a meaningless position.
    if (rect.height > 0 || rect.width > 0) {
      const anchorNow = rect.top + withinRatio * rect.height
      const target = containerTop + viewportOffset
      container.scrollTop += anchorNow - target
      return
    }
  }

  // Fallback: keep the same fraction of the document in view. Less precise,
  // but far better than leaving `scrollTop` untouched.
  const { scrollTop, scrollHeight } = captured
  if (scrollHeight <= 0) return
  const ratio = (scrollTop + viewportOffset) / scrollHeight
  container.scrollTop = ratio * container.scrollHeight - viewportOffset
}

/**
 * The deepest element at the given point that lies inside `container`.
 *
 * `elementFromPoint` can return something outside the container (an overlay,
 * the toolbar) or the container itself, neither of which moves with the
 * content — anchoring to those would defeat the whole exercise.
 */
function elementAt(container: HTMLElement, clientX: number, clientY: number): Element | null {
  const hit = document.elementFromPoint(clientX, clientY)
  if (hit && hit !== container && container.contains(hit)) return hit

  // Nothing directly under the point — the pointer is in a margin, or the
  // point is on the container's own padding. Use the first block of content
  // that is actually on screen.
  const content = container.firstElementChild
  if (!content) return null
  for (const child of Array.from(content.children)) {
    const rect = child.getBoundingClientRect()
    if (rect.bottom > clientY) return child
  }
  return content.lastElementChild ?? content
}
