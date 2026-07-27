import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CompletionContext } from '@codemirror/autocomplete'
import { foldService } from '@codemirror/language'
import {
  closeEnvironments,
  latexCompletions,
  latexDiagnostics,
  latexSupport
} from '@renderer/editor/source/latex-language'

// What the source view knows about LaTeX beyond how to colour it: which
// mistakes to flag, what to suggest, what folds, and what closes itself.

const stateOf = (doc: string): EditorState => EditorState.create({ doc })

const messages = (doc: string): string[] => latexDiagnostics(stateOf(doc)).map((d) => d.message)

describe('the linter', () => {
  it('says nothing about a well-formed document', () => {
    expect(messages('\\begin{align}\n  a &= b\n\\end{align}\n')).toEqual([])
  })

  it('flags an environment that is never closed', () => {
    // pdflatex reports this at the point it gives up, routinely hundreds of
    // lines below the line that is actually wrong.
    expect(messages('\\begin{align}\n  a &= b\n')).toEqual(['\\begin{align} is never closed'])
  })

  it('flags a close that does not match its open', () => {
    const found = messages('\\begin{align}\n  a &= b\n\\end{aligned}\n')
    expect(found).toContain('\\end{aligned} closes \\begin{align}')
  })

  it('flags a close with nothing open', () => {
    expect(messages('\\end{proof}')).toEqual(['\\end{proof} with no matching \\begin'])
  })

  it('points at the line with the odd $ on it', () => {
    const found = latexDiagnostics(stateOf('fine $x$ here\nbroken $y here\n'))
    expect(found).toHaveLength(1)
    expect(found[0].from).toBe('fine $x$ here\n'.length)
  })

  it('does not count an escaped \\$ or one inside a comment', () => {
    expect(messages('costs \\$5 today\n')).toEqual([])
    expect(messages('text % $ a note\n')).toEqual([])
  })
})

describe('completion', () => {
  const complete = (doc: string, explicit = false) => {
    const state = stateOf(doc)
    return latexCompletions(new CompletionContext(state, doc.length, explicit))
  }

  it('offers the labels this document defines inside a \\ref', () => {
    // The one completion worth having in a paper: it is the thing you
    // otherwise scroll away to look up.
    const result = complete('\\label{eq:bregman}\nSee \\cref{eq:')
    expect(result?.options.map((o) => o.label)).toContain('eq:bregman')
  })

  it('offers bibliography keys inside a \\cite', () => {
    const result = complete('\\bibitem{knuth84}\nAs in \\citep{')
    expect(result?.options.map((o) => o.label)).toContain('knuth84')
  })

  it('does not offer labels to a macro that does not take one', () => {
    const result = complete('\\label{eq:a}\n\\textbf{')
    expect(result).toBeNull()
  })

  it('offers environments inside \\begin, the document’s own first', () => {
    const result = complete('\\begin{myenv}\n\\end{myenv}\n\\begin{')
    const labels = result?.options.map((o) => o.label) ?? []
    expect(labels).toContain('myenv')
    expect(labels).toContain('align')
  })

  it('offers macros the preamble declares alongside the built-ins', () => {
    const result = complete('\\newcommand{\\norm}[1]{\\lVert #1 \\rVert}\n$\\no')
    const labels = result?.options.map((o) => o.label) ?? []
    expect(labels).toContain('\\norm')
    expect(labels).toContain('\\nonumber')
  })

  it('lists everything on a bare backslash, the paper’s own macros first', () => {
    // At that point the author has expressed no preference, and their own
    // notation is the shortest thing to remind them of.
    const result = complete('\\newcommand{\\norm}[1]{x}\n$\\')
    expect(result?.options[0].label).toBe('\\norm')
    expect((result?.options.length ?? 0) > 1).toBe(true)
  })

  it('offers nothing where a macro cannot start', () => {
    expect(complete('plain prose')).toBeNull()
  })
})

describe('closing an environment as it is opened', () => {
  /** Type a `}` at the end of `doc`, as the input handler would see it. */
  const typeBrace = (doc: string, at = doc.length): { handled: boolean; text: string } => {
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [closeEnvironments] })
    })
    view.dispatch({ selection: { anchor: at } })
    const handlers = view.state.facet(EditorView.inputHandler)
    const handled = handlers.some((handler) =>
      handler(view, at, at, '}', () => view.state.update({ changes: { from: at, insert: '}' } }))
    )
    const text = view.state.doc.toString()
    view.destroy()
    return { handled, text }
  }

  const type = (doc: string): string => typeBrace(doc).text

  it('writes the \\end and leaves the caret between the two', () => {
    expect(type('\\begin{align')).toBe('\\begin{align}\n  \n\\end{align}')
  })

  it('matches the indentation of the line it is on', () => {
    expect(type('  \\begin{cases')).toBe('  \\begin{cases}\n    \n  \\end{cases}')
  })

  it('leaves an environment that already has its \\end alone', () => {
    // Editing the name of an existing block must not produce a second closer.
    const doc = '\\begin{align\n  a &= b\n\\end{align}'
    expect(typeBrace(doc, '\\begin{align'.length).handled).toBe(false)
  })

  it('ignores a `}` that does not close a \\begin', () => {
    expect(typeBrace('\\textbf{bold').handled).toBe(false)
  })
})

describe('folding', () => {
  const foldAt = (doc: string, line: number): { from: number; to: number } | null => {
    const state = EditorState.create({ doc, extensions: [latexSupport()] })
    const target = state.doc.line(line)
    for (const service of state.facet(foldService)) {
      const range = service(state, target.from, target.to)
      if (range) return range
    }
    return null
  }

  it('folds an environment onto its \\begin line', () => {
    const doc = '\\begin{proof}\n  because.\n\\end{proof}\nafter'
    const range = foldAt(doc, 1)
    expect(range).not.toBeNull()
    expect(doc.slice(range!.from, range!.to)).toBe('\n  because.')
  })

  it('folds a section down to the next heading of the same rank', () => {
    const doc = '\\section{One}\nprose\n\\section{Two}\nmore'
    const range = foldAt(doc, 1)
    expect(doc.slice(range!.from, range!.to)).toBe('\nprose')
  })

  it('has nothing to fold on an ordinary line', () => {
    expect(foldAt('just prose\nand more', 1)).toBeNull()
  })
})
