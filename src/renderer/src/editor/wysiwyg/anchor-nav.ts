// Jumping from a citation or cross-reference to what it refers to.
//
// The node views set `href="#latex-anchor-…"` on their DOM, which looks like
// it should work and doesn't: the editor scrolls inside its own container,
// not the document, so the browser's fragment navigation has nothing to act
// on. Worse, in an Electron renderer a stray hash navigation can strand the
// app on a URL it can't route. So the link is handled here instead, and the
// href stays only as a hover affordance and a copy target.

/** Duration of the target highlight. Mirrors the CSS animation. */
const FLASH_MS = 1200

/**
 * The element carrying `anchorId`, preferring one inside the paper.
 *
 * `getElementById` returns the first match in the whole app, which is the
 * wrong scope: anything else that mirrors document structure (an outline, a
 * second view of the same paper) would win on document order and the jump
 * would land outside the text.
 */
function findAnchor(anchorId: string): HTMLElement | null {
  const paper = document.querySelector('.wysiwyg-editor')
  const inPaper = paper?.querySelector(`[id="${anchorId.replace(/"/g, '\\"')}"]`)
  if (inPaper) return inPaper as HTMLElement
  return document.getElementById(anchorId)
}

/**
 * Scroll the element with `anchorId` into view and flash it.
 *
 * Returns false when nothing on the page carries that id — a reference to a
 * label that doesn't exist, which is worth reporting rather than silently
 * doing nothing.
 */
export function jumpToAnchor(anchorId: string): boolean {
  const target = findAnchor(anchorId)
  if (!target) return false

  target.scrollIntoView({ behavior: 'smooth', block: 'center' })

  // Restart the animation even when the same target is clicked twice in a
  // row: removing the class and forcing a reflow is the standard way to
  // replay a CSS animation.
  target.classList.remove('latex-anchor--flash')
  void target.offsetWidth
  target.classList.add('latex-anchor--flash')
  window.setTimeout(() => target.classList.remove('latex-anchor--flash'), FLASH_MS)
  return true
}

/**
 * Wire an inline reference chip so clicking it navigates.
 *
 * `resolveAnchor` is called at click time rather than bound up front,
 * because the anchor changes as the user edits — a citation's target moves
 * when bibliography entries are reordered.
 */
export function attachAnchorNavigation(
  dom: HTMLElement,
  resolveAnchor: () => string | null
): void {
  dom.addEventListener('mousedown', (event) => {
    // Claim the event before ProseMirror turns it into a selection. Without
    // this the click lands as a caret placement and the navigation never
    // runs.
    event.preventDefault()
    event.stopPropagation()
  })
  dom.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const anchor = resolveAnchor()
    if (!anchor) return
    if (!jumpToAnchor(anchor)) {
      // The label is referenced but never defined. Say so on the element
      // itself — a silent no-op reads as a broken feature.
      dom.classList.add('cross-ref--missing')
      window.setTimeout(() => dom.classList.remove('cross-ref--missing'), FLASH_MS)
    }
  })
}
