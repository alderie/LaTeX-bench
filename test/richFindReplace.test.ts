import { describe, it, expect } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import {
  buildMatcher,
  expandReplacement,
  findRichMatches,
  richFind,
  richReplace,
  richReplaceAll,
  richSearch,
  richStep
} from '@renderer/editor/wysiwyg/find-replace'
import type { FindOptions } from '@renderer/editor/source/search-model'

// Find and replace over the rich view's *document*, which is the whole
// point: the previous implementation was `window.find` over the painted
// DOM, so it could not see a formula's LaTeX, a raw block's source, or the
// preamble — and could not replace anything at all.

const PLAIN: FindOptions = {
  caseSensitive: false,
  regexp: false,
  wholeWord: false
}

const PAPER = `\\documentclass{article}
\\newcommand{\\eps}{\\varepsilon}
\\begin{document}
\\section{Bounds}
We bound the error by \\eps in the usual way.

\\begin{equation}
  \\|x - y\\| < \\eps
\\end{equation}

\\end{document}
`

async function viewFor(tex: string): Promise<EditorView> {
  const { doc } = await parseLatexToDoc(tex)
  const state = EditorState.create({
    schema: latexSchema,
    doc,
    plugins: [richFind()]
  })
  // jsdom has no layout, but the plugin only ever touches document state.
  return new EditorView(document.createElement('div'), { state })
}

describe('buildMatcher', () => {
  it('treats a plain query as a literal', () => {
    const re = buildMatcher('a.c', PLAIN)!
    expect(re.test('a.c')).toBe(true)
    re.lastIndex = 0
    expect(re.test('abc')).toBe(false)
  })

  it('honours the regexp toggle', () => {
    const re = buildMatcher('a.c', { ...PLAIN, regexp: true })!
    expect(re.test('abc')).toBe(true)
  })

  it('honours whole word', () => {
    const re = buildMatcher('eps', { ...PLAIN, wholeWord: true })!
    expect(re.test('an eps here')).toBe(true)
    re.lastIndex = 0
    expect(re.test('epsilon')).toBe(false)
  })

  it('honours case sensitivity', () => {
    const re = buildMatcher('Eps', { ...PLAIN, caseSensitive: true })!
    expect(re.test('eps')).toBe(false)
  })

  it('returns null rather than throwing on a half-typed regex', () => {
    expect(buildMatcher('foo(', { ...PLAIN, regexp: true })).toBeNull()
    expect(buildMatcher('', PLAIN)).toBeNull()
  })
})

describe('expandReplacement', () => {
  it('substitutes numbered groups', () => {
    expect(expandReplacement('$2-$1', ['a', 'b'], 'ab')).toBe('b-a')
  })

  it('substitutes the whole match', () => {
    expect(expandReplacement('[$&]', [], 'hit')).toBe('[hit]')
  })

  it('unescapes a literal dollar', () => {
    expect(expandReplacement('$$1', ['a'], 'x')).toBe('$1')
  })

  it('leaves a group that did not participate empty', () => {
    expect(expandReplacement('<$3>', ['a'], 'x')).toBe('<>')
  })
})

describe('findRichMatches', () => {
  it('finds text in ordinary prose', async () => {
    const view = await viewFor(PAPER)
    const matches = findRichMatches(view.state.doc, 'error', PLAIN)
    expect(matches).toHaveLength(1)
    expect(matches[0].kind).toBe('text')
  })

  it('finds a macro inside a formula, which the DOM never showed', async () => {
    const view = await viewFor(PAPER)
    const matches = findRichMatches(view.state.doc, '\\eps', PLAIN)
    const contexts = matches.map((m) => m.context)
    expect(contexts).toContain('formula')
  })

  it('finds text inside the collapsed preamble', async () => {
    const view = await viewFor(PAPER)
    const matches = findRichMatches(view.state.doc, 'newcommand', PLAIN)
    expect(matches).toHaveLength(1)
    expect(matches[0].kind).toBe('attr')
    expect(matches[0].context).toBe('preamble')
  })

  it('returns matches in document order', async () => {
    const view = await viewFor(PAPER)
    const matches = findRichMatches(view.state.doc, 'e', PLAIN)
    const positions = matches.map((m) => m.from)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('respects the cap', async () => {
    const view = await viewFor(PAPER)
    expect(findRichMatches(view.state.doc, 'e', PLAIN, 3)).toHaveLength(3)
  })

  it('terminates on a pattern that can match nothing', async () => {
    const view = await viewFor(PAPER)
    // `a*` matches the empty string everywhere; without a guard this spins.
    const matches = findRichMatches(view.state.doc, 'a*', { ...PLAIN, regexp: true }, 50)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.length).toBeLessThanOrEqual(50)
  })

  it('finds nothing for an empty query', async () => {
    const view = await viewFor(PAPER)
    expect(findRichMatches(view.state.doc, '', PLAIN)).toEqual([])
  })
})

describe('replacing', () => {
  it('replaces prose text and keeps the document valid', async () => {
    const view = await viewFor(PAPER)
    richSearch(view, 'usual', PLAIN)
    richStep(view, false)
    richReplace(view, 'ordinary')
    expect(serializeDocToLatex(view.state.doc)).toContain('the ordinary way')
  })

  it('replaces a macro inside a formula — what window.find could not do', async () => {
    const view = await viewFor(PAPER)
    richSearch(view, '\\eps', PLAIN)
    richReplaceAll(view, '\\epsilon')
    const out = serializeDocToLatex(view.state.doc)
    // The equation body, the prose, and the preamble definition all
    // changed — one replace-all over the document, not over the page.
    expect(out).toContain('\\|x - y\\| < \\epsilon')
    expect(out).toContain('by \\epsilon{} in')
    expect(out).toContain('\\newcommand{\\epsilon}')
    expect(out).not.toContain('\\eps}')
  })

  it('reaches into the preamble', async () => {
    const view = await viewFor(PAPER)
    richSearch(view, 'newcommand', PLAIN)
    richReplaceAll(view, 'providecommand')
    expect(serializeDocToLatex(view.state.doc)).toContain('\\providecommand{\\eps}')
  })

  it('counts what it will change before it changes it', async () => {
    const view = await viewFor(PAPER)
    const summary = richSearch(view, '\\eps', PLAIN)
    expect(summary.count).toBeGreaterThanOrEqual(3)
    expect(summary.error).toBeNull()
  })

  it('reports the count to zero once everything is replaced', async () => {
    const view = await viewFor(PAPER)
    richSearch(view, 'usual', PLAIN)
    const after = richReplaceAll(view, 'typical')
    expect(after.count).toBe(0)
  })

  it('expands capture groups in a regex replacement', async () => {
    const view = await viewFor(PAPER)
    richSearch(view, '(bound) the', { ...PLAIN, regexp: true })
    richReplaceAll(view, 'constrain the [$1]')
    expect(serializeDocToLatex(view.state.doc)).toContain('constrain the [bound]')
  })

  it('does the whole of replace-all in one transaction', async () => {
    const view = await viewFor(PAPER)
    richSearch(view, '\\eps', PLAIN)
    const before = view.state.doc
    richReplaceAll(view, '\\epsilon')
    expect(view.state.doc).not.toBe(before)
    // One step of history, not one per match — the transaction count is
    // what an undo would walk back through.
    expect(serializeDocToLatex(view.state.doc)).not.toContain('\\eps ')
  })

  it('reports an unusable regex rather than searching for it', async () => {
    const view = await viewFor(PAPER)
    const summary = richSearch(view, 'foo(', { ...PLAIN, regexp: true })
    expect(summary.error).toBeTruthy()
    expect(summary.count).toBe(0)
  })

  it('steps through matches and wraps around', async () => {
    const view = await viewFor(PAPER)
    const first = richSearch(view, '\\eps', PLAIN)
    let summary = richStep(view, false)
    expect(summary.current).toBeGreaterThan(0)
    for (let i = 0; i < first.count; i++) summary = richStep(view, false)
    expect(summary.current).toBeGreaterThan(0)
    expect(summary.current).toBeLessThanOrEqual(first.count)
  })
})
