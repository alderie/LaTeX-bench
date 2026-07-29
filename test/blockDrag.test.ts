import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { blockDragGuard } from '@renderer/editor/wysiwyg/block-drag'

// Dragging inside an open block editor selects text; it doesn't pick the block
// up.
//
// Nothing here ever asked for a formula to be draggable — no node in the
// schema declares it and there is no drop handling of our own. It is the
// browser: a `contenteditable="false"` island inside a `contenteditable="true"`
// root is a drag source in Chromium by default, and every in-place editor in
// this app lives inside exactly such an island. So pressing on one and moving
// the pointer, which in a text field means "select from here to there", lifted
// the whole panel instead.
//
// Three cases, and the guard has to tell them apart: the open editor's island
// (cancel), a text field inside it (leave alone — that is the browser moving
// selected text, and it works), and a closed block (leave alone — dragging a
// figure somewhere else in the paper is a real thing to want).

let host: HTMLElement
let view: EditorView

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  view = new EditorView(host, {
    state: EditorState.create({
      schema: latexSchema,
      doc: latexSchema.nodes.doc.create({}, [
        latexSchema.nodes.preamble.create({ source: '' }),
        latexSchema.nodes.paragraph.create({}, latexSchema.text('text'))
      ]),
      plugins: [blockDragGuard()]
    })
  })
})

afterEach(() => {
  view.destroy()
  host.remove()
})

/** An element in the editor, standing in for whatever a node view built. */
function element(html: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  const el = wrap.firstElementChild as HTMLElement
  view.dom.appendChild(el)
  return el
}

function dragFrom(el: Element): boolean {
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return !event.defaultPrevented
}

describe('the block drag guard', () => {
  it('cancels a drag that starts on a block whose editor is open', () => {
    const block = element(
      '<div class="math-block math-block--editing" contenteditable="false"><div class="block-editor block-editor--formula"><textarea></textarea></div></div>'
    )
    expect(dragFrom(block)).toBe(false)
  })

  it('cancels a drag that starts on the editor chrome', () => {
    // The bar, the padding, the preview: everywhere in the panel that isn't a
    // field. This is where a real pointer lands most often.
    element(
      '<div class="math-block math-block--editing" contenteditable="false"><div class="block-editor"><div class="block-editor__bar"><span class="block-editor__name">Equation</span></div></div></div>'
    )
    const bar = view.dom.querySelector('.block-editor__name')!
    expect(dragFrom(bar)).toBe(false)
  })

  it('leaves a text field alone, so selected text can still be dragged in it', () => {
    element(
      '<div class="math-block math-block--editing" contenteditable="false"><div class="block-editor"><textarea class="code-field__input"></textarea></div></div>'
    )
    const field = view.dom.querySelector('textarea')!
    expect(dragFrom(field)).toBe(true)
  })

  it('leaves a single-line field alone too', () => {
    // Inline maths and the label field are inputs rather than textareas.
    element(
      '<span class="math-inline math-inline--editing" contenteditable="false"><span class="block-editor block-editor--inline"><input class="code-field__input" /></span></span>'
    )
    const field = view.dom.querySelector('input')!
    expect(dragFrom(field)).toBe(true)
  })

  it('leaves a closed block draggable', () => {
    // Moving a figure or an equation elsewhere in the paper is a real thing
    // to want, and ProseMirror already implements the drop. It is only a
    // problem when it fires instead of the selection you asked for.
    const block = element('<div class="math-block" contenteditable="false">rendered</div>')
    expect(dragFrom(block)).toBe(true)
  })

  it('leaves ordinary prose alone', () => {
    const paragraph = view.dom.querySelector('p')!
    expect(dragFrom(paragraph)).toBe(true)
  })

  it('stops guarding once the editor view is gone', () => {
    const block = element(
      '<div class="math-block math-block--editing" contenteditable="false"><div class="block-editor"></div></div>'
    )
    expect(dragFrom(block)).toBe(false)
    // Detached from the view, so the listener has to have been removed rather
    // than left on a DOM node the app still holds.
    const dom = view.dom
    view.destroy()
    dom.appendChild(block)
    expect(dragFrom(block)).toBe(true)
  })
})
