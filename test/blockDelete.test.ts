import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Command } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { codeBlockNodeView } from '@renderer/editor/wysiwyg/nodeviews/CodeBlockNodeView'
import {
  deleteBlockBackward,
  deleteBlockForward,
  isEmptyBlock
} from '@renderer/editor/wysiwyg/block-delete'

// Blocks with their own chrome — theorems, equations, listings — had no way
// out: the base keymap's joinBackward won't cross a `defining` boundary, so
// backspacing at the top of an emptied theorem did nothing at all.

const n = latexSchema.nodes

const para = (text?: string): PMNode => n.paragraph.create({}, text ? latexSchema.text(text) : null)

function stateOf(...blocks: PMNode[]): EditorState {
  return EditorState.create({
    doc: n.doc.create({}, [n.preamble.create({ source: '' }), ...blocks])
  })
}

/** Run a command with the caret at `pos`, returning the resulting doc. */
function run(state: EditorState, command: Command, pos: number): PMNode | null {
  const withCaret = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
  let next: PMNode | null = null
  const handled = command(withCaret, (tr) => {
    next = withCaret.apply(tr).doc
  })
  return handled ? next : null
}

const kinds = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.forEach((child) => out.push(child.type.name))
  return out
}

describe('what counts as an empty block', () => {
  it('reads an equation with only its wrapper as empty', () => {
    expect(isEmptyBlock(n.mathBlock.create({ latex: '\\[\n\n\\]' }))).toBe(true)
    expect(isEmptyBlock(n.mathBlock.create({ latex: '\\begin{align}\\end{align}' }))).toBe(true)
    expect(isEmptyBlock(n.mathBlock.create({ latex: '\\[ E = mc^2 \\]' }))).toBe(false)
  })

  it('reads a container as empty only when everything in it is', () => {
    expect(isEmptyBlock(n.theoremEnv.create({}, [para()]))).toBe(true)
    expect(isEmptyBlock(n.theoremEnv.create({}, [para(), para()]))).toBe(true)
    expect(isEmptyBlock(n.theoremEnv.create({}, [para('Statement.')]))).toBe(false)
  })

  it('counts a formula inside a paragraph as content', () => {
    const withMath = n.theoremEnv.create({}, [
      n.paragraph.create({}, n.mathInline.create({ latex: '$x$' }))
    ])
    expect(isEmptyBlock(withMath)).toBe(false)
  })
})

describe('backspace in an empty block', () => {
  it('deletes an emptied theorem', () => {
    const state = stateOf(n.theoremEnv.create({}, [para()]), para('After.'))
    // preamble(1) + theorem open(1) + paragraph open(1)
    const doc = run(state, deleteBlockBackward, 3)
    expect(doc).not.toBeNull()
    expect(kinds(doc!)).toEqual(['preamble', 'paragraph'])
  })

  it('leaves a theorem that still says something', () => {
    const state = stateOf(n.theoremEnv.create({}, [para('Statement.'), para()]))
    // Caret in the trailing empty paragraph: the paragraph is the empty
    // thing here, not the theorem, so the base keymap keeps the key.
    const at = state.doc.content.size - 2
    expect(run(state, deleteBlockBackward, at)).toBeNull()
  })

  it('deletes an empty listing rather than the paragraph before it', () => {
    const state = stateOf(para('Before.'), n.codeBlock.create({ code: '   ' }), para())
    const doc = run(state, deleteBlockBackward, state.doc.content.size - 1)
    expect(kinds(doc!)).toEqual(['preamble', 'paragraph', 'paragraph'])
  })

  it('reaches back for an equation that renders to nothing', () => {
    // An empty display equation is invisible on the page, so backspacing
    // from the paragraph after it is the only way to aim at one.
    const state = stateOf(para('Before.'), n.mathBlock.create({ latex: '\\[\\]' }), para())
    const doc = run(state, deleteBlockBackward, state.doc.content.size - 1)
    expect(kinds(doc!)).toEqual(['preamble', 'paragraph', 'paragraph'])
  })

  it('will not reach back for an equation that has something in it', () => {
    const state = stateOf(para('Before.'), n.mathBlock.create({ latex: '\\[x\\]' }), para())
    expect(run(state, deleteBlockBackward, state.doc.content.size - 1)).toBeNull()
  })

  it('deletes a selected block outright', () => {
    const state = stateOf(para('Before.'), n.mathBlock.create({ latex: '\\[x\\]' }))
    const pos = state.doc.content.size - 1
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    let doc: PMNode | null = null
    expect(deleteBlockBackward(selected, (tr) => (doc = selected.apply(tr).doc))).toBe(true)
    expect(kinds(doc!)).toEqual(['preamble', 'paragraph'])
  })
})

describe('delete in an empty block', () => {
  it('takes the empty block ahead of the caret', () => {
    const state = stateOf(para(), n.mathBlock.create({ latex: '\\[\\]' }), para('After.'))
    const doc = run(state, deleteBlockForward, 2)
    expect(kinds(doc!)).toEqual(['preamble', 'paragraph', 'paragraph'])
  })

  it('deletes the empty container the caret is in', () => {
    const state = stateOf(n.theoremEnv.create({}, [para()]), para('After.'))
    const doc = run(state, deleteBlockForward, 3)
    expect(kinds(doc!)).toEqual(['preamble', 'paragraph'])
  })
})

// A block edited in its own textarea is a hole the keymap can't see into:
// the field is chrome, so the key never reaches ProseMirror at all.
describe('backspace inside a block that edits in a textarea', () => {
  let view: EditorView | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    document.body.replaceChildren()
  })

  const openListing = (code: string): HTMLTextAreaElement => {
    const place = document.createElement('div')
    document.body.appendChild(place)
    view = new EditorView(place, {
      state: stateOf(n.codeBlock.create({ code }), para('After.')),
      nodeViews: { codeBlock: codeBlockNodeView }
    })
    const block = view.dom.querySelector('.code-block') as HTMLElement
    block.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    return block.querySelector('textarea') as HTMLTextAreaElement
  }

  const press = (el: Element, key: string): void => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
  }

  it('deletes the listing once its last character is gone', () => {
    const ta = openListing('x')
    ta.value = ''
    press(ta, 'Backspace')
    expect(kinds(view!.state.doc)).toEqual(['preamble', 'paragraph'])
  })

  it('leaves a listing that still has code in it', () => {
    const ta = openListing('print(1)')
    press(ta, 'Backspace')
    expect(kinds(view!.state.doc)).toEqual(['preamble', 'codeBlock', 'paragraph'])
  })
})
