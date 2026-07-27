import { describe, it, expect, beforeEach, vi } from 'vitest'
import { attachAnchorNavigation, jumpToAnchor } from '@renderer/editor/wysiwyg/anchor-nav'

// Citations and cross-references set `href="#latex-anchor-…"`, which looks
// like it should work and doesn't: the editor scrolls its own container, not
// the document. Clicking one used to do nothing at all.

describe('anchor navigation', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    // jsdom has no layout, so scrollIntoView isn't implemented.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('scrolls to the target and flashes it', () => {
    const target = document.createElement('div')
    target.id = 'latex-anchor-thm-main'
    document.body.appendChild(target)

    expect(jumpToAnchor('latex-anchor-thm-main')).toBe(true)
    expect(target.scrollIntoView).toHaveBeenCalled()
    expect(target.classList.contains('latex-anchor--flash')).toBe(true)
  })

  it('reports a reference to a label that does not exist', () => {
    expect(jumpToAnchor('latex-anchor-nonexistent')).toBe(false)
  })

  it('resolves the target at click time, not at bind time', () => {
    const chip = document.createElement('a')
    document.body.appendChild(chip)

    let current = 'latex-anchor-first'
    attachAnchorNavigation(chip, () => current)

    const first = document.createElement('div')
    first.id = 'latex-anchor-first'
    const second = document.createElement('div')
    second.id = 'latex-anchor-second'
    document.body.append(first, second)

    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(first.classList.contains('latex-anchor--flash')).toBe(true)

    // The document changed underneath — a bibliography reorder, say.
    current = 'latex-anchor-second'
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(second.classList.contains('latex-anchor--flash')).toBe(true)
  })

  it('marks the chip when its label is missing', () => {
    const chip = document.createElement('a')
    document.body.appendChild(chip)
    attachAnchorNavigation(chip, () => 'latex-anchor-gone')
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(chip.classList.contains('cross-ref--missing')).toBe(true)
  })

  it('swallows the mousedown so ProseMirror does not steal the click', () => {
    const chip = document.createElement('a')
    document.body.appendChild(chip)
    attachAnchorNavigation(chip, () => null)
    const event = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    chip.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
