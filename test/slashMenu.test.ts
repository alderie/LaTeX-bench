import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
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

/** Take the highlighted entry, the way pressing Enter on the menu does. */
function choose(view: EditorView): void {
  const event = new window.KeyboardEvent('keydown', { key: 'Enter' })
  view.someProp('handleKeyDown', (handler) => handler(view, event))
}

function ancestorNames(view: EditorView): string[] {
  const { $from } = view.state.selection
  return Array.from({ length: $from.depth + 1 }, (_, d) => $from.node(d).type.name)
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

  it('survives a space while the words still match something', () => {
    // The names worth searching for have spaces in them — a cross-reference
    // reads "Theorem 3.2" — so closing on the space bar killed the menu
    // exactly when it was about to become useful.
    const view = makeView()
    type(view, '/bulleted list')
    expect(menuState(view).from).not.toBeNull()
    expect(menuState(view).query).toBe('bulleted list')
    view.destroy()
  })

  it('closes once the words stop matching anything', () => {
    const view = makeView()
    type(view, '/eq and so we conclude')
    expect(menuState(view).from).toBeNull()
    view.destroy()
  })

  it('closes on a space typed straight after the slash', () => {
    const view = makeView()
    type(view, '/ ')
    expect(menuState(view).from).toBeNull()
    view.destroy()
  })

  it('does not stay open over a whole sentence', () => {
    const view = makeView()
    type(view, `/${'x'.repeat(60)}`)
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

  it('lands on the equation it just inserted', () => {
    // Nothing ever passed a caret offset, so every insert left the selection
    // wherever the mapping dropped it — next to the new block, not in it.
    // Selecting an atom is what runs its node view's `selectNode`, which is
    // what opens the formula editor.
    const view = makeView()
    type(view, '/matrix')
    choose(view)
    const selection = view.state.selection
    expect(selection).toBeInstanceOf(NodeSelection)
    expect((selection as NodeSelection).node.type.name).toBe('mathBlock')
    view.destroy()
  })

  it('puts the caret inside the body of a theorem', () => {
    const view = makeView()
    type(view, '/lemma')
    choose(view)
    expect(ancestorNames(view)).toContain('theoremEnv')
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
    view.destroy()
  })

  it('puts the caret in the first item of a list', () => {
    const view = makeView()
    type(view, '/bulleted')
    choose(view)
    expect(ancestorNames(view)).toContain('listItem')
    view.destroy()
  })

  it('lands after a figure rather than on it', () => {
    // A figure's node view has no editor to open, so selecting it would
    // just arm it: the next keystroke would replace the figure.
    const doc = latexSchema.nodes.doc.create({}, [
      latexSchema.nodes.preamble.create({ source: '' }),
      latexSchema.nodes.paragraph.create(),
      latexSchema.nodes.paragraph.create({}, latexSchema.text('after'))
    ])
    const place = document.createElement('div')
    document.body.appendChild(place)
    const view = new EditorView(place, {
      state: EditorState.create({ doc, plugins: [slashMenu()] })
    })
    // Caret in the first, empty paragraph.
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(2))))

    type(view, '/figure')
    choose(view)
    expect(allOfType(view.state.doc, 'figure')).toHaveLength(1)
    expect(view.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(view.state.selection.$from.parent.textContent).toBe('after')
    view.destroy()
  })

  it('selects inline maths so its editor opens', () => {
    const view = makeView('and ')
    type(view, '/inline math')
    choose(view)
    const selection = view.state.selection
    expect(selection).toBeInstanceOf(NodeSelection)
    expect((selection as NodeSelection).node.type.name).toBe('mathInline')
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

  it('can be searched for by the name it prints, space and all', async () => {
    const { doc } = await parseLatexToDoc(String.raw`\documentclass{article}
\begin{document}
\begin{theorem}\label{thm:main}Statement.\end{theorem}
\end{document}
`)
    labelRegistry.rebuild(doc)
    const pretty = labelRegistry.getState().byKey.get('thm:main')!.pretty
    expect(pretty).toMatch(/^Theorem \d/)

    const view = makeView()
    type(view, `/${pretty.toLowerCase()}`)
    expect(menuState(view).query).toBe(pretty.toLowerCase())

    choose(view)
    const refs = allOfType(view.state.doc, 'crossRef')
    expect(refs).toHaveLength(1)
    expect(refs[0].attrs.label).toBe('thm:main')
    view.destroy()
  })
})
