import { describe, it, expect, beforeEach } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import * as labelRegistry from '@renderer/editor/wysiwyg/labelRegistry'
import { loadBibliography, setBibEntries } from '@renderer/editor/bibliography'
import { citeOptions } from '@renderer/editor/source/latex-language'

// The gap this closes: a paper that keeps its references in a `.bib` and
// ends with `\bibliography{references}` has no `\bibitem` anywhere, so
// every `\cite` resolved to nothing and rendered as an unresolved chip,
// and `\cite{` completed from an empty list.

const BIB = `
@article{tsallis1988,
  author  = {Tsallis, Constantino},
  title   = {Possible generalization of Boltzmann-Gibbs statistics},
  journal = {Journal of Statistical Physics},
  year    = {1988}
}
@inproceedings{smith2020,
  author    = {Smith, Jane and Doe, John},
  title     = {A study of things},
  booktitle = {Proceedings of Things},
  year      = {2020}
}
`

const BIBTEX_PAPER = `\\documentclass{article}
\\begin{document}
Entropy generalises \\cite{tsallis1988}, and so does \\cite{smith2020}.
Also \\cite{missing2001}.
\\bibliography{references}
\\end{document}
`

const BIBITEM_PAPER = `\\documentclass{article}
\\begin{document}
As shown in \\cite{tsallis1988}.
\\begin{thebibliography}{9}
\\bibitem{tsallis1988} Tsallis, C. (1988). Possible generalization.
\\end{thebibliography}
\\end{document}
`

describe('citations backed by references.bib', () => {
  beforeEach(() => {
    setBibEntries([])
  })

  it('resolves cite keys with no \\bibitem in the document', async () => {
    await loadBibliography(BIB)
    const { doc } = await parseLatexToDoc(BIBTEX_PAPER)
    labelRegistry.rebuild(doc)

    const tsallis = labelRegistry.getCitation('tsallis1988')
    expect(tsallis).toBeDefined()
    expect(tsallis!.shortLabel).toBe('Tsallis, 1988')
    expect(tsallis!.source).toBe('bib')
    expect(tsallis!.summary).toContain('Journal of Statistical Physics')
  })

  it('numbers them in order of first citation', async () => {
    await loadBibliography(BIB)
    const { doc } = await parseLatexToDoc(BIBTEX_PAPER)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getCitation('tsallis1988')!.number).toBe(1)
    expect(labelRegistry.getCitation('smith2020')!.number).toBe(2)
  })

  it('leaves a key that is in neither place unresolved', async () => {
    await loadBibliography(BIB)
    const { doc } = await parseLatexToDoc(BIBTEX_PAPER)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getCitation('missing2001')).toBeUndefined()
  })

  it('resolves nothing when the bibliography is empty', async () => {
    const { doc } = await parseLatexToDoc(BIBTEX_PAPER)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getCitation('tsallis1988')).toBeUndefined()
  })

  it('re-resolves when the .bib finishes parsing after the paper loaded', async () => {
    // The real order of events: the document is on screen first and the
    // async bib parse lands a moment later.
    const { doc } = await parseLatexToDoc(BIBTEX_PAPER)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getCitation('tsallis1988')).toBeUndefined()
    await loadBibliography(BIB)
    expect(labelRegistry.getCitation('tsallis1988')).toBeDefined()
  })
})

describe('citations backed by \\bibitem', () => {
  beforeEach(() => {
    setBibEntries([])
  })

  it('keeps the document’s own numbering', async () => {
    await loadBibliography(BIB)
    const { doc } = await parseLatexToDoc(BIBITEM_PAPER)
    labelRegistry.rebuild(doc)
    const cite = labelRegistry.getCitation('tsallis1988')!
    expect(cite.number).toBe(1)
    expect(cite.source).toBe('bibitem')
  })

  it('takes the better label from the .bib when there is one', async () => {
    await loadBibliography(BIB)
    const { doc } = await parseLatexToDoc(BIBITEM_PAPER)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getCitation('tsallis1988')!.shortLabel).toBe('Tsallis, 1988')
  })

  it('still guesses from the prose when the .bib has nothing', async () => {
    const { doc } = await parseLatexToDoc(BIBITEM_PAPER)
    labelRegistry.rebuild(doc)
    const cite = labelRegistry.getCitation('tsallis1988')!
    expect(cite.source).toBe('bibitem')
    expect(cite.shortLabel).toContain('1988')
  })
})

describe('\\cite completion', () => {
  beforeEach(() => {
    setBibEntries([])
  })

  it('offers bib keys the document never declares', async () => {
    await loadBibliography(BIB)
    expect(citeOptions([], '').map((o) => o.label)).toEqual(['smith2020', 'tsallis1988'])
  })

  it('shows enough to identify the work', async () => {
    await loadBibliography(BIB)
    const option = citeOptions([], 'tsallis')[0]
    expect(option.detail).toContain('Tsallis, 1988')
    expect(option.detail).toContain('Possible generalization')
  })

  it('matches on an author’s name', async () => {
    await loadBibliography(BIB)
    expect(citeOptions([], 'smith').map((o) => o.label)).toEqual(['smith2020'])
  })

  it('matches on a word from the title', async () => {
    // You remember "the Tsallis entropy one", not `tsallis1988`.
    await loadBibliography(BIB)
    expect(citeOptions([], 'boltzmann').map((o) => o.label)).toEqual(['tsallis1988'])
  })

  it('puts a key-prefix match ahead of a title match', async () => {
    await loadBibliography(BIB)
    const labels = citeOptions([], 's').map((o) => o.label)
    expect(labels[0]).toBe('smith2020')
  })

  it('does not offer a bib key twice when the document also declares it', async () => {
    await loadBibliography(BIB)
    const labels = citeOptions(['tsallis1988'], '').map((o) => o.label)
    expect(labels.filter((l) => l === 'tsallis1988')).toHaveLength(1)
  })

  it('still offers in-document bibitems with no .bib at all', () => {
    expect(citeOptions(['knuth1984'], '').map((o) => o.label)).toEqual(['knuth1984'])
  })
})
