import { Plugin } from 'prosemirror-state'

// Dragging inside an open block editor selects text. It doesn't pick the
// block up.
//
// Nothing in this editor ever asked for a formula to be draggable. No node in
// the schema declares `draggable`, and there is no drop handling of our own.
// It comes from the browser: a `contenteditable="false"` island inside a
// `contenteditable="true"` root is a drag source in Chromium by default, and
// every in-place editor in this app — the formula, the table, the preamble,
// a raw block — lives inside exactly such an island. So pressing on one and
// moving the pointer, which in a text field means "select from here to
// there", instead lifted the whole panel and carried a picture of it around.
//
// The rule is the narrow one. A drag whose source is a real text field is the
// browser moving selected text within that field, which works and is worth
// keeping. A drag whose source is anything else inside an open editor is the
// accident above, and is cancelled.
//
// A *closed* block is left alone: dragging a figure or an equation to
// somewhere else in the paper is a real thing to want, ProseMirror already
// implements the drop, and it is only a problem when it fires instead of the
// selection you asked for.

/** Fields that manage their own text drag, and should keep managing it. */
function isTextField(node: EventTarget | null): boolean {
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
}

/**
 * Whether this drag is starting from a block whose editor is open.
 *
 * Two directions, because the browser may name either end as the source: the
 * island around the panel (which *contains* a `.block-editor`), or something
 * inside the panel (which is *within* one).
 */
function insideOpenEditor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('.block-editor') || target.querySelector('.block-editor'))
}

/**
 * A capturing listener, not `handleDOMEvents`.
 *
 * Every node view that opens an editor returns `true` from `stopEvent` while
 * it is open — which is right, and which means ProseMirror discards the event
 * before any plugin prop is consulted. The one moment this guard exists for
 * is the one moment it would never be called. Capture on the editor's own
 * root is early enough to see it regardless.
 */
export function blockDragGuard(): Plugin {
  return new Plugin({
    view: (view) => {
      const onDragStart = (event: DragEvent): void => {
        if (isTextField(event.target)) return
        if (!insideOpenEditor(event.target)) return
        event.preventDefault()
        event.stopPropagation()
      }
      view.dom.addEventListener('dragstart', onDragStart, true)
      return {
        destroy: () => view.dom.removeEventListener('dragstart', onDragStart, true)
      }
    }
  })
}
