// The other half of a block editor's entrance.
//
// A formula and its editor replace each other in place. Opening is animated
// by the panel itself — it is a new element, so a CSS animation on it plays
// when it arrives — but closing puts back a rendering that is also new, and
// nothing distinguishes that from the re-render an equation gets when the
// numbering changes. A block that flashed every time the registry renumbered
// it would be worse than one that never animated at all.
//
// So the node view says when: once, after an edit ends.

const CLASS = 'block-settling'

/** Play a block's arrival animation, once. */
export function settle(el: HTMLElement): void {
  el.classList.remove(CLASS)
  // Reading a layout property is what makes the removal take effect before
  // the class goes back on; without it a second edit in a row doesn't
  // animate, because as far as the browser is concerned nothing changed.
  void el.offsetWidth
  el.classList.add(CLASS)

  // An author who has asked for reduced motion gets no animation, and an
  // animation that never starts never ends — so there would be nothing to
  // take the class back off, and every block ever edited would keep it.
  if (typeof el.getAnimations === 'function' && el.getAnimations().length === 0) {
    el.classList.remove(CLASS)
    return
  }

  const done = (event: AnimationEvent): void => {
    // This element's own animation, not a descendant's: the event bubbles,
    // and anything inside a block is free to animate for its own reasons.
    if (event.target !== el) return
    el.classList.remove(CLASS)
    el.removeEventListener('animationend', done)
  }
  el.addEventListener('animationend', done)
}
