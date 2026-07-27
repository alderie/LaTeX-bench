import { describe, it, expect, vi } from 'vitest'
import { settle } from '@renderer/editor/wysiwyg/nodeviews/settle'

// The half of a block editor's transition that CSS can't do on its own: a
// rendering that replaces an editor is a new element, but so is the one that
// replaces a renumbered equation, and only the first should arrive.

function block(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'math-block'
  document.body.appendChild(el)
  return el
}

function ended(el: HTMLElement, target: EventTarget = el): void {
  const event = new window.Event('animationend', { bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  el.dispatchEvent(event)
}

describe('a block arriving', () => {
  it('marks the block for one animation', () => {
    const el = block()
    settle(el)
    expect(el.classList.contains('block-settling')).toBe(true)
  })

  it('takes the mark off once the animation has run', () => {
    const el = block()
    settle(el)
    ended(el)
    expect(el.classList.contains('block-settling')).toBe(false)
  })

  it('is not fooled by something inside the block animating', () => {
    // A block holds whatever it holds; an animation that finishes in there
    // says nothing about this one.
    const el = block()
    const child = document.createElement('span')
    el.appendChild(child)
    settle(el)
    ended(el, child)
    expect(el.classList.contains('block-settling')).toBe(true)
    ended(el)
    expect(el.classList.contains('block-settling')).toBe(false)
  })

  it('leaves nothing behind when the animation was turned off', () => {
    // `prefers-reduced-motion`. An animation that never starts never ends,
    // so nothing would take the mark off again.
    const el = block()
    el.getAnimations = vi.fn(() => [])
    settle(el)
    expect(el.classList.contains('block-settling')).toBe(false)
  })

  it('animates again the next time, having been reset first', () => {
    const el = block()
    settle(el)
    ended(el)
    settle(el)
    expect(el.classList.contains('block-settling')).toBe(true)
  })
})
