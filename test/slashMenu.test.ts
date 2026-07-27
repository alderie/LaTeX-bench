import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { slashMenu, slashMenuKey } from '@renderer/editor/wysiwyg/slashMenu'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import * as labelRegistry from '@renderer/editor/wysiwyg/labelRegistry'
import { allOfType } from './helpers'

// The slash menu is a small state machine over transactions. These tests
// drive it the way typing does — insert text, check the plugin state — so a
// regression in the open/close rules shows up without a browser.

function makeView(initialText = ''): EditorView {
  const doc = latexSchema.nodes.doc.create({}, [
    latexSchema.nodes.preamble.create({ source: '' }),
    latexSchema.nodes.paragraph.create(
      {},
      initialText ? latexSchema.text(initialText) : undefined
    )
  ])
  const state = EditorState.create({ doc, plugins: [slashMenu()] })
  const place = document.createElement('div')
  document.body.appendChild(place)
  const view = new EditorView(place, { state })
  // Caret at the end of the paragraph.
  const end = view.state.doc.content.size - 1
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))))
  return view
}

function type(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

function menuState(view: EditorView): { from: number | null; query: string } {
  return slashMenuKey.getState(view.state)!
}

describe('slash menu — open and close rules', () => {
  it('opens on a slash at the start of a block', () => {
    const view = makeView()
    type(view, '/')
    expect(menuState(view).from).not.toBeNull()
    view.destroy()
  })

  it('opens on a slash after a space', () => {
    const view = makeView('some text ')
    type(view, '/')
    expect(menuState(view).from).not.toBeNull()
    view.destroy()
  })

  it('stays closed for a slash inside a word', () => {
    // Otherwise typing a path or a fraction in prose pops the menu open.
    const view = makeView('and/or')
    type(view, '/')
    expect(menuState(view).from).toBeNull()
    view.destroy()
  })

  it('tracks the query as it is typed', () => {
    const view = makeView()
    type(view, '/matr')
    expect(menuState(view).query).toBe('matr')
    view.destroy()
  })

  it('closes on a space, the way an @-mention does', () => {
    const view = makeView()
    type(view, '/eq ')
    expect(menuState(view).from).toBeNull()
    view.destroy()
  })

  it('closes when the caret moves back behind the slash', () => {
    const view = makeView()
    type(view, '/eq')
    const before = menuState(view).from!
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(before))))
    expect(menuState(view).from).toBeNull()
    view.destroy()
  })
})

describe('slash menu — insertion', () => {
  it('replaces the typed query with the chosen structure', () => {
    const view = makeView()
    type(view, '/matrix')
    const state = menuState(view)
    expect(state.from).not.toBeNull()

    // Drive the same path a click takes: delete the query range, insert.
    const from = state.from!
    const to = view.state.selection.head
    const tr = view.state.tr.delete(from, to)
    const $pos = tr.doc.resolve(from)
    const parent = $pos.parent
    const node = latexSchema.nodes.mathBlock.create({
      latex: '\\[\n\\begin{pmatrix}\n  0 & 0 \\\\\n  0 & 0\n\\end{pmatrix}\n\\]'
    })
    const start = $pos.before()
    tr.replaceWith(start, start + parent.nodeSize, node)
    view.dispatch(tr)

    const blocks = allOfType(view.state.doc, 'mathBlock')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].attrs.latex).toContain('\\begin{pmatrix}')
    // The `/matrix` text is gone — not left behind next to the equation.
    expect(view.state.doc.textBetween(0, view.state.doc.content.size, ' ')).not.toContain('/matrix')
    view.destroy()
  })
})

describe('slash menu — icons', () => {
  it('gives every row a glyph', () => {
    // Fifteen rows of near-identical text get read one line at a time; a
    // distinct shape per kind is what makes the list scannable.
    const view = makeView()
    type(view, '/')
    const rows = document.querySelectorAll('.slash-menu__item')
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) {
      expect(row.querySelector('.slash-menu__icon svg')).not.toBeNull()
    }
    view.destroy()
  })

  it('uses different glyphs for different kinds of insert', () => {
    const view = makeView()
    type(view, '/')
    const shapes = new Set(
      [...document.querySelectorAll('.slash-menu__icon svg')].map((svg) => svg.innerHTML)
    )
    expect(shapes.size).toBeGreaterThan(4)
    view.destroy()
  })

  it('keeps icons out of the accessibility tree', () => {
    // Every glyph sits next to its own label, so announcing it would read
    // the entry's name twice.
    const view = makeView()
    type(view, '/')
    for (const svg of document.querySelectorAll('.slash-menu__icon svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
    view.destroy()
  })
})

describe('slash menu — live entries from the document', () => {
  beforeEach(() => {
    labelRegistry.rebuild(latexSchema.nodes.doc.create({}, [latexSchema.nodes.paragraph.create()]))
  })

  it('offers the document’s own citation keys and labels', async () => {
    const { doc } = await parseLatexToDoc(String.raw`\documentclass{article}
\begin{document}
\section{Setup}\label{sec:setup}
\begin{theorem}\label{thm:main}Statement.\end{theorem}
Text \cite{knuth1984}.
\begin{thebibliography}{9}
\bibitem{knuth1984} D.~Knuth. \emph{The TeXbook}. 1984.
\end{thebibliography}
\end{document}
`)
    labelRegistry.rebuild(doc)
    const state = labelRegistry.getState()
    // These are what the menu reads; if they're empty the Citations and
    // Cross-references groups silently vanish.
    expect(state.citations.has('knuth1984')).toBe(true)
    expect(state.byKey.has('sec:setup')).toBe(true)
    expect(state.byKey.get('thm:main')?.pretty).toMatch(/^Theorem /)
  })
})
