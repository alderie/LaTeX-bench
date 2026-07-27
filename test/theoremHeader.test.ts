import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { DOMParser, type Node as PMNode } from 'prosemirror-model'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { theoremNodeView } from '@renderer/editor/wysiwyg/nodeviews/TheoremNodeView'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'

// A theorem's name and its label are how it gets referred to — in prose and
// in `\cref` respectively — so they are the parts most often rewritten. They
// used to be drawn by a CSS `::before` reading a data attribute: correct on
// screen and impossible to click, which left the source view as the only way
// to change either. Both are live fields in the header now.

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

const field = (v: EditorView, which: 'name' | 'label'): HTMLInputElement =>
  header(v).querySelector(`.theorem-head__${which} .head-field__input`) as HTMLInputElement

const titleOf = (v: EditorView): string | null =>
  (v.state.doc.child(1).attrs.title as string | null) ?? null

const labelOf = (v: EditorView): string | null =>
  (v.state.doc.child(1).attrs.label as string | null) ?? null

function click(el: Element): void {
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

function press(el: Element, key: string): void {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
}

/** Type into a field the way a person would, resize handler and all. */
function type(input: HTMLInputElement, value: string): void {
  input.focus()
  input.value = value
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
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
    expect(field(v, 'name').value).toBe('Bregman divergence')
  })

  it('keeps the body separate from the header, so prose still edits', () => {
    const v = open()
    const body = v.dom.querySelector('[data-theorem-body]')
    expect(body?.textContent).toBe('Statement.')
    expect(body?.querySelector('.theorem-head')).toBeNull()
  })

  it('offers the name and the label as one bar, filled or not', () => {
    const v = open()
    expect(field(v, 'name').value).toBe('')
    expect(field(v, 'label').value).toBe('')
    // Empty fields are invisible until the theorem is hovered, but they hold
    // their place in the row — the header must not jump when one is filled.
    expect(header(v).querySelectorAll('.head-field')).toHaveLength(2)
  })

  it('renames from the header', () => {
    const v = open({ title: 'Old name' })
    const input = field(v, 'name')
    type(input, 'New name')
    press(input, 'Enter')
    expect(titleOf(v)).toBe('New name')
  })

  it('names an untitled theorem', () => {
    const v = open()
    const input = field(v, 'name')
    type(input, 'Bregman divergence')
    press(input, 'Enter')
    expect(titleOf(v)).toBe('Bregman divergence')
  })

  it('throws the edit away on Escape', () => {
    const v = open({ title: 'Old name' })
    const input = field(v, 'name')
    type(input, 'Discarded')
    press(input, 'Escape')
    expect(titleOf(v)).toBe('Old name')
    expect(field(v, 'name').value).toBe('Old name')
  })

  it('keeps what was typed when focus moves on', () => {
    const v = open({ title: 'Old name' })
    const input = field(v, 'name')
    type(input, 'Committed')
    input.blur()
    expect(titleOf(v)).toBe('Committed')
  })

  it('clearing the name removes the title rather than storing an empty one', () => {
    const v = open({ title: 'Old name' })
    const input = field(v, 'name')
    type(input, '   ')
    press(input, 'Enter')
    expect(titleOf(v)).toBeNull()
  })

  it('labels a theorem from the same bar', () => {
    const v = open()
    const input = field(v, 'label')
    type(input, 'thm:main')
    press(input, 'Enter')
    expect(labelOf(v)).toBe('thm:main')
    expect(serializeDocToLatex(v.state.doc)).toContain('\\label{thm:main}')
  })

  it('changes the environment from the header', () => {
    const v = open()
    const picker = header(v).querySelector('.theorem-head__kind') as HTMLElement
    // The kinds are worked out on first interaction, not at construction.
    picker.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    click(picker.querySelector('.ui-dropdown__button')!)
    const rows = [...document.querySelectorAll('.ui-dropdown__menu .ui-dropdown__option')]
    expect(rows.map((r) => (r as HTMLElement).dataset.value)).toContain('lemma')
    const lemma = rows.find((r) => (r as HTMLElement).dataset.value === 'lemma')!
    lemma.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(v.state.doc.child(1).attrs.kind).toBe('lemma')
  })

  it('takes its popup with it when the theorem goes away', () => {
    const v = open()
    const picker = header(v).querySelector('.theorem-head__kind') as HTMLElement
    click(picker.querySelector('.ui-dropdown__button')!)
    expect(document.querySelector('.ui-dropdown__menu')).not.toBeNull()
    v.destroy()
    view = null
    expect(document.querySelector('.ui-dropdown__menu')).toBeNull()
  })

  // Deleting a theorem is the margin handle's job — one delete control for
  // every kind of block rather than a second one per header. See blockDelete.

  it('writes the renamed title back into the LaTeX', () => {
    const v = open()
    const input = field(v, 'name')
    type(input, 'Bregman divergence')
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
        '<header class="theorem-head"><div class="ui-dropdown"><button>Lemma</button></div>' +
        '<label class="head-field theorem-head__name"><input value="Key bound"></label></header>' +
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
