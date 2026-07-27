import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import {
  publishSelection,
  setActiveEditorView,
  setBlockKind,
  useEditorSelection,
  type BlockKind
} from '@renderer/editor/wysiwyg/editor-bridge'

// The toolbar's heading control. A heading here is not a paragraph in a
// bigger font — it is a `section` node whose first child is the title and
// whose remaining children are what the section contains, which is what
// `\section{…}` means in the file. So the interesting cases are the ones
// where changing the kind has to move content, not just an attribute.

const n = latexSchema.nodes

const para = (text: string): PMNode => n.paragraph.create({}, latexSchema.text(text))

function section(level: number, title: string, ...body: PMNode[]): PMNode {
  return n.section.create({ id: '', level, starred: false, labels: [] }, [
    n.sectionTitle.create({ level }, latexSchema.text(title)),
    ...body
  ])
}

let view: EditorView | null = null

/** Mount a document with the caret inside the first text of `target`. */
function mount(blocks: PMNode[], caretIn: string): EditorView {
  const doc = n.doc.create({}, [n.preamble.create({ source: '' }), ...blocks])
  const state = EditorState.create({ doc })
  const host = document.createElement('div')
  document.body.appendChild(host)
  view = new EditorView(host, {
    state,
    dispatchTransaction(tr) {
      const next = view!.state.apply(tr)
      view!.updateState(next)
      publishSelection(next)
    }
  })

  let at = -1
  doc.descendants((node, pos) => {
    if (at !== -1) return false
    if (node.isText && node.text === caretIn) at = pos + 1
    return true
  })
  if (at === -1) throw new Error(`no text "${caretIn}" in the document`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
  setActiveEditorView(view)
  publishSelection(view.state)
  return view
}

const outline = (): string[] => {
  const out: string[] = []
  view!.state.doc.forEach((child) => {
    out.push(
      child.type.name === 'section'
        ? `section${child.attrs.level as number}`
        : child.type.name
    )
  })
  return out
}

const block = (): BlockKind => useEditorSelection.getState().block

describe('what the toolbar reports', () => {
  afterEach(() => {
    setActiveEditorView(null)
    view?.destroy()
    view = null
    document.body.replaceChildren()
  })

  it('reads a heading as its level', () => {
    mount([section(2, 'Setup', para('text'))], 'Setup')
    expect(block()).toBe(2)
  })

  it('reads a paragraph as body text', () => {
    mount([section(1, 'Method', para('prose'))], 'prose')
    expect(block()).toBe('body')
  })

  it('offers nothing for a paragraph that cannot become a heading', () => {
    // A `\section` inside a float would end the environment it is in.
    const float = n.floatBlock.create({ kind: 'table', args: '', centering: false }, [
      para('inside a float')
    ])
    mount([float], 'inside a float')
    expect(block()).toBe('other')
  })
})

describe('changing a block kind', () => {
  afterEach(() => {
    setActiveEditorView(null)
    view?.destroy()
    view = null
    document.body.replaceChildren()
  })

  it('changes a heading level without moving anything', () => {
    mount([section(1, 'Method', para('prose'))], 'Method')
    setBlockKind(3)
    expect(outline()).toEqual(['preamble', 'section3'])
    expect(serializeDocToLatex(view!.state.doc)).toContain('\\subsubsection{Method}')
  })

  it('keeps the title and the section agreeing on the level', () => {
    // They are read by different things — the section by the serializer, the
    // title by the stylesheet — and a disagreement shows as a `\section`
    // rendered like a subsection.
    mount([section(1, 'Method')], 'Method')
    setBlockKind(2)
    const node = view!.state.doc.child(1)
    expect(node.attrs.level).toBe(2)
    expect(node.firstChild?.attrs.level).toBe(2)
  })

  it('promotes a paragraph, taking what follows it into the new section', () => {
    // A heading in LaTeX runs until the next one; leaving the prose after it
    // outside would mean the document rearranged itself on the next load.
    mount([para('Results'), para('first'), para('second')], 'Results')
    setBlockKind(1)
    expect(outline()).toEqual(['preamble', 'section1'])
    const created = view!.state.doc.child(1)
    expect(created.childCount).toBe(3)
    expect(created.firstChild?.type.name).toBe('sectionTitle')
    const tex = serializeDocToLatex(view!.state.doc)
    expect(tex).toContain('\\section{Results}')
    expect(tex).toContain('first')
    expect(tex).toContain('second')
  })

  it('leaves the caret in the title it just made', () => {
    mount([para('Results'), para('first')], 'Results')
    setBlockKind(1)
    const { $head } = view!.state.selection
    expect($head.parent.type.name).toBe('sectionTitle')
    expect(block()).toBe(1)
  })

  it('demotes a heading back to prose, keeping the section body in place', () => {
    mount([section(1, 'Method', para('prose'))], 'Method')
    setBlockKind('body')
    expect(outline()).toEqual(['preamble', 'paragraph', 'paragraph'])
    const tex = serializeDocToLatex(view!.state.doc)
    expect(tex).not.toContain('\\section{Method}')
    expect(tex).toContain('Method')
    expect(tex).toContain('prose')
  })

  it('promotes inside a section, so the new one nests', () => {
    mount([section(1, 'Method', para('Ablations'), para('detail'))], 'Ablations')
    setBlockKind(2)
    const outer = view!.state.doc.child(1)
    const inner = outer.child(1)
    expect(inner.type.name).toBe('section')
    expect(inner.attrs.level).toBe(2)
    expect(serializeDocToLatex(view!.state.doc)).toContain('\\subsection{Ablations}')
  })

  it('does nothing for a paragraph asked to become body text', () => {
    mount([section(1, 'Method', para('prose'))], 'prose')
    const before = view!.state.doc
    setBlockKind('body')
    expect(view!.state.doc).toBe(before)
  })
})
