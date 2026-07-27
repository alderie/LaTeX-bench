import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { DOMParser, type Node as PMNode } from 'prosemirror-model'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { theoremNodeView } from '@renderer/editor/wysiwyg/nodeviews/TheoremNodeView'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'

// A theorem's title is how it gets referred to in prose, so it is the part
// most often rewritten. It used to be drawn by a CSS `::before` reading a
// data attribute — correct on screen and impossible to click, which left the
// source view as the only way to rename anything.

let view: EditorView | null = null

function open(attrs: Record<string, unknown> = {}): EditorView {
  const doc = latexSchema.nodes.doc.create({}, [
    latexSchema.nodes.preamble.create({ source: '' }),
    latexSchema.nodes.theoremEnv.create({ kind: 'theorem', label: null, title: null, ...attrs }, [
      latexSchema.nodes.paragraph.create({}, latexSchema.text('Statement.'))
    ])
  ])
  const place = document.createElement('div')
  document.body.appendChild(place)
  view = new EditorView(place, {
    state: EditorState.create({ doc }),
    nodeViews: { theoremEnv: theoremNodeView }
  })
  return view
}

const header = (v: EditorView): HTMLElement =>
  v.dom.querySelector('.theorem-head') as HTMLElement

const titleOf = (v: EditorView): string | null =>
  (v.state.doc.child(1).attrs.title as string | null) ?? null

function click(el: Element): void {
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

function press(el: Element, key: string): void {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('theorem header', () => {
  afterEach(() => {
    view?.destroy()
    view = null
    document.body.replaceChildren()
  })

  it('renders a real element rather than generated content', () => {
    const v = open({ title: 'Bregman divergence' })
    expect(header(v)).not.toBeNull()
    expect(header(v).querySelector('.theorem-head__title')?.textContent).toBe(
      '(Bregman divergence)'
    )
  })

  it('keeps the body separate from the header, so prose still edits', () => {
    const v = open()
    const body = v.dom.querySelector('[data-theorem-body]')
    expect(body?.textContent).toBe('Statement.')
    expect(body?.querySelector('.theorem-head')).toBeNull()
  })

  it('offers a way in when there is no title yet', () => {
    const v = open()
    expect(header(v).querySelector('.theorem-head__add')).not.toBeNull()
  })

  it('renames from a click on the title', () => {
    const v = open({ title: 'Old name' })
    click(header(v).querySelector('.theorem-head__title')!)
    const input = header(v).querySelector('.theorem-head__input') as HTMLInputElement
    expect(input.value).toBe('Old name')
    input.value = 'New name'
    press(input, 'Enter')
    expect(titleOf(v)).toBe('New name')
  })

  it('names an untitled theorem', () => {
    const v = open()
    click(header(v).querySelector('.theorem-head__add')!)
    const input = header(v).querySelector('.theorem-head__input') as HTMLInputElement
    input.value = 'Bregman divergence'
    press(input, 'Enter')
    expect(titleOf(v)).toBe('Bregman divergence')
  })

  it('throws the edit away on Escape', () => {
    const v = open({ title: 'Old name' })
    click(header(v).querySelector('.theorem-head__title')!)
    const input = header(v).querySelector('.theorem-head__input') as HTMLInputElement
    input.value = 'Discarded'
    press(input, 'Escape')
    expect(titleOf(v)).toBe('Old name')
  })

  it('closes on a click elsewhere, keeping what was typed', () => {
    // Several handlers in this app call preventDefault on mousedown so they
    // don't steal focus, and those clicks never produce a blur.
    const v = open({ title: 'Old name' })
    click(header(v).querySelector('.theorem-head__title')!)
    const input = header(v).querySelector('.theorem-head__input') as HTMLInputElement
    input.value = 'Committed'
    document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    expect(titleOf(v)).toBe('Committed')
    expect(header(v).querySelector('.theorem-head__input')).toBeNull()
  })

  it('clearing the name removes the title rather than storing an empty one', () => {
    const v = open({ title: 'Old name' })
    click(header(v).querySelector('.theorem-head__title')!)
    const input = header(v).querySelector('.theorem-head__input') as HTMLInputElement
    input.value = '   '
    press(input, 'Enter')
    expect(titleOf(v)).toBeNull()
  })

  it('changes the environment from the header', () => {
    const v = open()
    const select = header(v).querySelector('.theorem-head__kind') as HTMLSelectElement
    select.dispatchEvent(new window.Event('focus'))
    expect([...select.options].map((o) => o.value)).toContain('lemma')
    select.value = 'lemma'
    select.dispatchEvent(new window.Event('change'))
    expect(v.state.doc.child(1).attrs.kind).toBe('lemma')
  })

  it('writes the renamed title back into the LaTeX', () => {
    const v = open()
    click(header(v).querySelector('.theorem-head__add')!)
    const input = header(v).querySelector('.theorem-head__input') as HTMLInputElement
    input.value = 'Bregman divergence'
    press(input, 'Enter')
    expect(serializeDocToLatex(v.state.doc)).toContain('\\begin{theorem}[Bregman divergence]')
  })
})

describe('reading a theorem back out of the DOM', () => {
  // ProseMirror re-parses the live DOM after a mutation it can't account
  // for, and parses `toDOM` output off the clipboard. The node view's
  // header is in one of those and not the other.
  const parse = (html: string): ReturnType<typeof DOMParser.prototype.parse> => {
    const holder = document.createElement('div')
    holder.innerHTML = html
    return DOMParser.fromSchema(latexSchema).parse(holder)
  }

  it('keeps the header out of the body when the node view rendered it', () => {
    const doc = parse(
      '<aside data-theorem data-kind="lemma" data-title="Key bound">' +
        '<header class="theorem-head"><select><option>lemma</option></select>' +
        '<button class="theorem-head__title">(Key bound)</button></header>' +
        '<div data-theorem-body><p>Statement.</p></div></aside>'
    )
    const theorem = findTheorem(doc)
    expect(theorem.attrs.kind).toBe('lemma')
    expect(theorem.attrs.title).toBe('Key bound')
    expect(theorem.textContent).toBe('Statement.')
  })

  it('still reads the plain shape that toDOM produces', () => {
    const doc = parse('<aside data-theorem data-kind="proof"><p>Immediate.</p></aside>')
    expect(findTheorem(doc).textContent).toBe('Immediate.')
  })
})

function findTheorem(doc: ReturnType<typeof DOMParser.prototype.parse>): PMNode {
  let found: PMNode | null = null
  doc.descendants((node) => {
    if (node.type.name === 'theoremEnv' && !found) found = node
    return !found
  })
  if (!found) throw new Error('no theorem parsed')
  return found
}
