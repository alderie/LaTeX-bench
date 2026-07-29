import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { inputRules } from 'prosemirror-inputrules'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import {
  activeListKind,
  bulletListRule,
  insertList,
  listKeymap,
  orderedListRule,
  toggleList
} from '@renderer/editor/wysiwyg/lists'
import { allOfType, flatText } from './helpers'

// Editing a list, rather than only reading one.
//
// `itemize` and `enumerate` parsed, rendered and round-tripped before any of
// this — and there was no way to make one, get out of one, or add an item to
// one. Enter split the *paragraph* inside the item, which put a blank line in
// the middle of an `\item`; Tab did nothing, so a nested list could be read
// but never written; and the toolbar's two buttons only ever wrapped, so
// pressing "bulleted" inside a bulleted list gave you a bulleted list inside
// a bulleted list.
//
// Every assertion here ends at the LaTeX, because the LaTeX is the document.

async function docFrom(body: string) {
  const { doc } = await parseLatexToDoc(
    `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`
  )
  return doc
}

async function stateFrom(body: string): Promise<EditorState> {
  return EditorState.create({ schema: latexSchema, doc: await docFrom(body) })
}

/** Put the caret at the first position inside the nth text block. */
function caretIn(state: EditorState, blockIndex: number, offset = 0): EditorState {
  const starts: number[] = []
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) starts.push(pos + 1)
    return true
  })
  const at = starts[blockIndex]
  if (at === undefined) throw new Error(`no text block ${blockIndex}`)
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(at + offset))))
}

/** Put the caret at the end of the nth text block. */
function caretAtEndOf(state: EditorState, blockIndex: number): EditorState {
  const blocks: Array<{ pos: number; size: number }> = []
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ pos, size: node.content.size })
    return true
  })
  const block = blocks[blockIndex]
  if (!block) throw new Error(`no text block ${blockIndex}`)
  return state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(block.pos + 1 + block.size)))
  )
}

/** Run a command and hand back the state it produced, or throw if it declined. */
function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | null = null
  const ok = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!ok || !next) throw new Error('the command declined to run')
  return next
}

/** Whether a command would do anything here, without doing it. */
function applies(state: EditorState, command: Command): boolean {
  return command(state, undefined)
}

const tex = (state: EditorState): string => serializeDocToLatex(state.doc)

describe('making a list out of a paragraph', () => {
  it('wraps the paragraph the caret is in', async () => {
    const state = caretIn(await stateFrom('One two three.'), 0)
    const out = tex(run(state, toggleList('itemize')))
    expect(out).toContain('\\begin{itemize}')
    expect(out).toContain('\\item One two three.')
    expect(out).toContain('\\end{itemize}')
  })

  it('makes a numbered list when that is what was asked for', async () => {
    const state = caretIn(await stateFrom('One two three.'), 0)
    expect(tex(run(state, toggleList('enumerate')))).toContain('\\begin{enumerate}')
  })

  it('leaves the text alone', async () => {
    const state = caretIn(await stateFrom('One two three.'), 0)
    expect(flatText(run(state, toggleList('itemize')).doc)).toContain('One two three.')
  })
})

describe('toggling a list off', () => {
  const LIST = '\\begin{itemize}\n  \\item Alpha\n  \\item Beta\n\\end{itemize}'

  it('takes the item back out of the list', async () => {
    // The operation that did not exist: every way into a list was one-way,
    // and getting back out meant switching to Source view.
    const state = caretIn(await stateFrom(LIST), 0)
    const out = tex(run(state, toggleList('itemize')))
    expect(out).toContain('Alpha')
    // The other item is still a list — lifting acts on the item you are in.
    expect(out).toContain('\\item Beta')
  })

  it('changes kind rather than unwrapping when the other button is pressed', async () => {
    const state = caretIn(await stateFrom(LIST), 0)
    const out = tex(run(state, toggleList('enumerate')))
    expect(out).toContain('\\begin{enumerate}')
    expect(out).not.toContain('\\begin{itemize}')
    // Both items came along: this is one attribute changing, not a rebuild.
    expect(out).toContain('\\item Alpha')
    expect(out).toContain('\\item Beta')
  })

  it('keeps an \\item[term] through a kind change', async () => {
    // Rebuilding the nodes would drop these, and they are the author's own
    // text rather than anything the editor put there.
    const state = caretIn(
      await stateFrom('\\begin{description}\n  \\item[Bregman] A divergence.\n\\end{description}'),
      0
    )
    expect(tex(run(state, toggleList('itemize')))).toContain('\\item[Bregman]')
  })

  it('drops enumitem options that described the kind it no longer is', async () => {
    // `label=(\roman*)` on an itemize is a compile error waiting to happen,
    // and carrying it across would be the editor writing LaTeX nobody asked
    // for.
    const state = caretIn(
      await stateFrom('\\begin{enumerate}[label=(\\roman*)]\n  \\item One\n\\end{enumerate}'),
      0
    )
    expect(tex(run(state, toggleList('itemize')))).not.toContain('roman')
  })
})

describe('Enter', () => {
  const LIST = '\\begin{itemize}\n  \\item Alpha\n  \\item Beta\n\\end{itemize}'

  it('makes the next item', async () => {
    // It used to split the paragraph inside the item, which serialized as an
    // `\item` with a blank line through the middle of it.
    const state = caretAtEndOf(await stateFrom(LIST), 0)
    const after = run(state, listKeymap.Enter)
    expect(allOfType(after.doc, 'listItem')).toHaveLength(3)
    expect(tex(after)).not.toMatch(/\\item Alpha\n\n/)
  })

  it('splits an item where the caret is', async () => {
    const state = caretIn(await stateFrom(LIST), 0, 4)
    const after = run(state, listKeymap.Enter)
    expect(allOfType(after.doc, 'listItem')).toHaveLength(3)
    // Nothing is lost in the split, wherever it lands.
    expect(flatText(after.doc).replace(/\s+/g, '')).toContain('Alpha')
  })

  it('ends the list from an empty item', async () => {
    // Enter twice is how every editor finishes a list.
    const state = caretIn(await stateFrom('\\begin{itemize}\n  \\item Alpha\n\\end{itemize}'), 0)
    const opened = run(caretAtEndOf(state, 0), listKeymap.Enter)
    const ended = run(opened, listKeymap.Enter)
    expect(allOfType(ended.doc, 'listItem').length).toBeLessThan(
      allOfType(opened.doc, 'listItem').length
    )
  })
})

describe('Tab and Shift-Tab', () => {
  const LIST = '\\begin{itemize}\n  \\item Alpha\n  \\item Beta\n\\end{itemize}'

  it('nests the item under the one above it', async () => {
    // A nested list could be parsed and rendered and never written.
    const state = caretIn(await stateFrom(LIST), 1)
    const out = tex(run(state, listKeymap.Tab))
    expect(out).toContain('\\begin{itemize}')
    // Two opens, two closes: the inner list is inside the outer one.
    expect(out.match(/\\begin\{itemize\}/g)).toHaveLength(2)
    expect(out.match(/\\end\{itemize\}/g)).toHaveLength(2)
  })

  it('nests into a list of the same kind', async () => {
    const state = caretIn(
      await stateFrom('\\begin{enumerate}\n  \\item A\n  \\item B\n\\end{enumerate}'),
      1
    )
    const out = tex(run(state, listKeymap.Tab))
    expect(out.match(/\\begin\{enumerate\}/g)).toHaveLength(2)
    expect(out).not.toContain('itemize')
  })

  it('will not nest the first item, which has nothing to nest under', async () => {
    const state = caretIn(await stateFrom(LIST), 0)
    expect(applies(state, listKeymap.Tab)).toBe(false)
  })

  it('un-nests on Shift-Tab', async () => {
    const nested = run(caretIn(await stateFrom(LIST), 1), listKeymap.Tab)
    const back = run(caretIn(nested, 1), listKeymap['Shift-Tab'])
    expect(tex(back).match(/\\begin\{itemize\}/g)).toHaveLength(1)
  })

  it('does nothing outside a list', async () => {
    const state = caretIn(await stateFrom('Just a paragraph.'), 0)
    expect(applies(state, listKeymap.Tab)).toBe(false)
    expect(applies(state, listKeymap['Shift-Tab'])).toBe(false)
  })
})

describe('Backspace at the head of an item', () => {
  const LIST = '\\begin{itemize}\n  \\item Alpha\n  \\item Beta\n\\end{itemize}'

  it('outdents rather than doing nothing', async () => {
    // `listItem` is `defining`, so the base keymap's `joinBackward` refuses
    // to cross it — the first item of a list was somewhere the caret could
    // get into and not back out of.
    const state = caretIn(await stateFrom(LIST), 0)
    expect(tex(run(state, listKeymap.Backspace))).toContain('Alpha')
  })

  it('leaves Backspace alone anywhere else in the item', async () => {
    const state = caretIn(await stateFrom(LIST), 1, 3)
    expect(applies(state, listKeymap.Backspace)).toBe(false)
  })

  it('leaves Backspace alone outside a list', async () => {
    const state = caretIn(await stateFrom('A paragraph.'), 0)
    expect(applies(state, listKeymap.Backspace)).toBe(false)
  })
})

describe('typing a list into existence', () => {
  // `- ` and `1. ` are what people already type when they are sketching a
  // list, and the alternative is remembering that the menu calls it
  // "itemize". Driven through a real view, because an input rule is a
  // property of the view's key handling rather than a command that can be
  // called.
  function open(state: EditorState): EditorView {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return new EditorView(host, {
      state: EditorState.create({
        schema: latexSchema,
        doc: state.doc,
        selection: state.selection,
        plugins: [inputRules({ rules: [bulletListRule, orderedListRule] })]
      })
    })
  }

  function type(view: EditorView, text: string): string {
    for (const char of text) {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, char))
      if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
    }
    const out = serializeDocToLatex(view.state.doc)
    view.destroy()
    return out
  }

  /** An empty paragraph with the caret in it — where a list is typed. */
  async function blank(): Promise<EditorState> {
    const state = caretIn(await stateFrom('X'), 0)
    const at = state.selection.from
    return state.apply(state.tr.delete(at, at + 1))
  }

  it('turns "- " into a bulleted list', async () => {
    expect(type(open(await blank()), '- ')).toContain('\\begin{itemize}')
  })

  it('turns "1. " into a numbered list', async () => {
    expect(type(open(await blank()), '1. ')).toContain('\\begin{enumerate}')
  })

  it('lets what is typed next become the item', async () => {
    const out = type(open(await blank()), '- Alpha')
    expect(out).toContain('\\item Alpha')
  })

  it('leaves a dash in the middle of a sentence alone', async () => {
    const state = caretAtEndOf(await stateFrom('Well'), 0)
    const out = type(open(state), ' - ')
    expect(out).not.toContain('itemize')
    expect(out).toContain('Well')
  })
})

describe('what the toolbar is told', () => {
  it('reports the list the caret is in', async () => {
    const state = caretIn(await stateFrom('\\begin{enumerate}\n  \\item One\n\\end{enumerate}'), 0)
    expect(activeListKind(state)).toBe('enumerate')
  })

  it('reports the innermost list when they are nested', async () => {
    const state = caretIn(
      await stateFrom(
        '\\begin{itemize}\n  \\item A\n  \\begin{enumerate}\n    \\item B\n  \\end{enumerate}\n\\end{itemize}'
      ),
      1
    )
    expect(activeListKind(state)).toBe('enumerate')
  })

  it('reports nothing in ordinary prose', async () => {
    expect(activeListKind(caretIn(await stateFrom('Prose.'), 0))).toBeNull()
  })
})

describe('inserting a list from the menu', () => {
  it('leaves the caret inside the first item', async () => {
    const state = caretIn(await stateFrom('Text.'), 0)
    const after = run(state, insertList('itemize'))
    expect(activeListKind(after)).toBe('itemize')
  })
})
