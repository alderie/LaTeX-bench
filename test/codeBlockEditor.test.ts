import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { codeBlockNodeView } from '@renderer/editor/wysiwyg/nodeviews/CodeBlockNodeView'

// A listing opens in the panel every other block opens in — with one
// difference that matters: its body is not LaTeX, so it isn't coloured as if
// it were, and Tab indents instead of leaving the block.

const n = latexSchema.nodes

function mount(code = 'def f(x):\n    return x'): {
  view: EditorView
  block: HTMLElement
  field: HTMLTextAreaElement
} {
  const doc = n.doc.create({}, [
    n.preamble.create({ source: '' }),
    n.codeBlock.create({ code, env: 'lstlisting', options: 'language=Python', language: 'Python' })
  ])
  const host = document.createElement('div')
  document.body.appendChild(host)
  const view = new EditorView(host, {
    state: EditorState.create({ doc }),
    nodeViews: { codeBlock: codeBlockNodeView }
  })
  // Selecting the node is what opens its editor, the same way it is for a
  // formula — that's what lets an insert land the caret inside a new listing.
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)))
  const block = host.querySelector('.code-block') as HTMLElement
  return { view, block, field: block.querySelector('textarea') as HTMLTextAreaElement }
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('the code block editor', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens in the shared panel, named by its language', () => {
    const { block } = mount()
    expect(block.querySelector('.block-editor')).not.toBeNull()
    expect(block.querySelector('.block-editor__name')?.textContent).toBe('Python')
    expect(block.querySelector('.block-editor__note')?.textContent).toBe('2 lines')
  })

  it('does not colour the body as LaTeX', () => {
    // A `lstlisting` holds Python; painting `\n` in it as a macro would be a
    // confident lie about what the author wrote.
    const { block } = mount()
    expect(block.querySelector('.code-field--plain')).not.toBeNull()
    expect(block.querySelectorAll('.tok--command').length).toBe(0)
  })

  it('indents on Tab instead of leaving the listing', () => {
    const { field } = mount('x = 1')
    field.setSelectionRange(0, 0)
    press(field, 'Tab')
    expect(field.value).toBe('    x = 1')
  })

  it('writes the edit back on ⌘⏎', () => {
    const { view, field } = mount()
    field.value = 'print(1)'
    press(field, 'Enter', { metaKey: true })
    expect(view.state.doc.child(1).attrs.code).toBe('print(1)')
  })

  it('throws the edit away on Escape', () => {
    const { view, field } = mount('x = 1')
    field.value = 'ruined'
    press(field, 'Escape')
    expect(view.state.doc.child(1).attrs.code).toBe('x = 1')
  })

  it('keeps the environment and its options untouched', () => {
    const { view, field } = mount()
    field.value = 'pass'
    press(field, 'Enter', { metaKey: true })
    const node = view.state.doc.child(1)
    expect(node.attrs.env).toBe('lstlisting')
    expect(node.attrs.options).toBe('language=Python')
  })

  it('deletes the listing from the bar', () => {
    const { view, block } = mount()
    const danger = block.querySelector('.block-editor__button--danger') as HTMLButtonElement
    danger.click()
    expect(view.state.doc.childCount).toBe(1)
  })
})
