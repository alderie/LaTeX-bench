import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { isTabularSource, renderTabular } from '@renderer/editor/wysiwyg/renderers/tabular'
import { isStructuralSource, renderStructural } from '@renderer/editor/wysiwyg/renderers/structural'
import * as labelRegistry from '@renderer/editor/wysiwyg/labelRegistry'
import { allOfType, fixture, flatText } from './helpers'

// test/fixtures/damaged-heavy-tail.tex is a real file as an older build of
// this editor left it: citations emptied, a tabular stripped of its column
// spec, accents dropped. Users have files in this state. Opening one must
// recover what's recoverable and — above all — not make it worse.

describe('opening a file damaged by an earlier version', () => {
  it('recovers citation keys that were left as loose prose', async () => {
    const { doc } = await parseLatexToDoc(fixture('damaged-heavy-tail.tex'))
    const cites = allOfType(doc, 'citation').map((n) => n.attrs.keys as string[])
    expect(cites).toContainEqual(['nazin2019algorithms', 'gorbunov2020stochastic'])
    expect(cites).toContainEqual(['cont2001empirical'])
    // …and the keys are no longer sitting in the paragraph text.
    const text = flatText(doc)
    expect(text).not.toContain('nazin2019algorithms')
    expect(text).toContain('Stochastic optimization under heavy-tailed noise')
  })

  it('resolves the recovered citations against the bibliography', async () => {
    const { doc } = await parseLatexToDoc(fixture('damaged-heavy-tail.tex'))
    labelRegistry.rebuild(doc)
    // A recovered key that resolves is the difference between "[3]" and a
    // dangling "[?]" in the rendered paper.
    expect(labelRegistry.getCitation('cont2001empirical')).toBeDefined()
    expect(labelRegistry.getCitation('howard2021time')).toBeDefined()
  })

  it('gives a tabular back the column spec that was deleted', async () => {
    // This used to be preserved as-is and merely *rendered* around. It
    // isn't a cosmetic problem: `\begin{tabular}` with no argument makes
    // LaTeX read `\toprule` as the column spec and abort the run with "Use
    // of \@array doesn't match its definition" — and the aborted run leaves
    // the .aux incomplete, so every \cite and \ref reports undefined as
    // well. The document round trips unchanged, so it comes back on every
    // build until something puts the spec back.
    const { doc } = await parseLatexToDoc(fixture('damaged-heavy-tail.tex'))
    const raw = allOfType(doc, 'rawLatex')
      .map((n) => n.attrs.source as string)
      .find((s) => s.includes('\\begin{tabular}'))
    expect(raw).toBeDefined()
    expect(raw).toMatch(/\\begin\{tabular\}\{lccc\}/)

    const table = renderTabular(raw!).querySelector('table')!
    const rows = Array.from(table.querySelectorAll('tr'))
    expect(rows.length).toBeGreaterThan(2)
    expect(rows[1].querySelectorAll('td').length).toBe(4)
    expect(rows[1].textContent).toContain('Method')
  })

  it('still renders a spec-less tabular handed to it directly', async () => {
    // The renderer's own tolerance stays: the repair runs on parse, and a
    // table can reach the renderer from an editor buffer that hasn't been
    // through one.
    const spec_less = '\\begin{tabular}\\toprule\nA & B & C \\\\\n\\bottomrule\n\\end{tabular}'
    expect(isTabularSource(spec_less)).toBe(true)
    const table = renderTabular(spec_less).querySelector('table')!
    expect(table.querySelectorAll('tr').length).toBeGreaterThan(0)
  })

  it('does not introduce new damage when re-saved', async () => {
    const tex = fixture('damaged-heavy-tail.tex')
    const { doc } = await parseLatexToDoc(tex)
    const once = serializeDocToLatex(doc)
    const { doc: doc2 } = await parseLatexToDoc(once)
    expect(serializeDocToLatex(doc2)).toBe(once)
    // The repair is durable: keys stay inside the argument.
    expect(once).toContain('\\cite{nazin2019algorithms,gorbunov2020stochastic}')
    expect(once).not.toContain('\\cite{}')
  })
})

describe('structural macros', () => {
  it('recognises the boundary markers', () => {
    expect(isStructuralSource('\\appendix')).toBe(true)
    expect(isStructuralSource('  \\tableofcontents  ')).toBe(true)
    expect(isStructuralSource('\\bibliographystyle{plain}')).toBe(true)
    // Anything with real content is not a bare marker.
    expect(isStructuralSource('\\begin{tabular}{ll}a&b\\\\\\end{tabular}')).toBe(false)
    expect(isStructuralSource('\\cventry{2016}{PhD}')).toBe(false)
  })

  it('renders a labelled divider rather than a box of source', () => {
    const el = renderStructural('\\appendix')
    expect(el.className).toContain('structural-marker')
    expect(el.textContent).toContain('Appendix')
    // The raw macro name is what we're replacing; it must not show.
    expect(el.textContent).not.toContain('\\appendix')
  })

  it('shows the argument of a marker that takes one', () => {
    const el = renderStructural('\\bibliographystyle{plain}')
    expect(el.textContent).toContain('Bibliography style')
    expect(el.textContent).toContain('plain')
  })
})
