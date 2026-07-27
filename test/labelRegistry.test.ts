import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import * as labelRegistry from '@renderer/editor/wysiwyg/labelRegistry'
import { fixture } from './helpers'

describe('labelRegistry', () => {
  it('numbers theorems with section.theorem and resolves \\cref text', async () => {
    const { doc } = await parseLatexToDoc(`\\documentclass{article}
\\begin{document}
\\section{Setup}\\label{sec:setup}
\\begin{theorem}\\label{thm:upper}Statement.\\end{theorem}
\\begin{lemma}\\label{lem:bias}Bias.\\end{lemma}
\\section{Lower bound}
\\begin{theorem}\\label{thm:lower}Lower.\\end{theorem}
\\end{document}
`)
    labelRegistry.rebuild(doc)
    const upper = labelRegistry.getLabel('thm:upper')
    expect(upper).toBeDefined()
    expect(upper!.number).toBe('1.1')
    expect(upper!.pretty).toBe('Theorem 1.1')

    const bias = labelRegistry.getLabel('lem:bias')
    expect(bias!.number).toBe('1.2')
    expect(bias!.pretty).toBe('Lemma 1.2')

    const lower = labelRegistry.getLabel('thm:lower')
    expect(lower!.number).toBe('2.3')
    expect(lower!.pretty).toBe('Theorem 2.3')

    const sec = labelRegistry.getLabel('sec:setup')
    expect(sec!.number).toBe('1')
    expect(sec!.pretty).toBe('Section 1')
  })

  it('numbers equations per-line in align and skips \\nonumber', async () => {
    const { doc } = await parseLatexToDoc(`\\documentclass{article}
\\begin{document}
\\begin{align}
a &= b \\label{eq:one}\\\\
c &= d \\nonumber\\\\
e &= f \\label{eq:three}
\\end{align}
\\end{document}
`)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getLabel('eq:one')!.eqrefText).toBe('(1)')
    // eq:three — second numbered line (third \\\\-separated chunk, but the
    // middle one was \nonumber, so this should be (2) not (3)).
    expect(labelRegistry.getLabel('eq:three')!.eqrefText).toBe('(2)')
  })

  it('starred sections and starred math envs do not bump counters', async () => {
    const { doc } = await parseLatexToDoc(`\\documentclass{article}
\\begin{document}
\\section{One}
\\begin{equation}\\label{eq:a}x=1\\end{equation}
\\section*{Acks}
\\begin{equation*}y=2\\end{equation*}
\\section{Three}
\\begin{equation}\\label{eq:b}z=3\\end{equation}
\\end{document}
`)
    labelRegistry.rebuild(doc)
    // Acknowledgments is starred — does not increment the section counter,
    // so "Three" is section 2, not 3.
    expect(labelRegistry.getLabel('eq:a')!.eqrefText).toBe('(1)')
    expect(labelRegistry.getLabel('eq:b')!.eqrefText).toBe('(2)')
  })

  it('exposes the same domAnchor for all keys on a multi-label section', async () => {
    const { doc } = await parseLatexToDoc(`\\documentclass{article}
\\begin{document}
\\section{Setup}\\label{sec:a}\\label{sec:b}
Body.
\\end{document}
`)
    labelRegistry.rebuild(doc)
    const a = labelRegistry.getLabel('sec:a')
    const b = labelRegistry.getLabel('sec:b')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a!.domAnchor).toBe(b!.domAnchor)
  })

  it('numbers bibitems in document order and exposes citation lookup', async () => {
    const { doc } = await parseLatexToDoc(`\\documentclass{article}
\\begin{document}
We cite \\citep{smith2020,jones2021} and \\citet{doe2019}.
\\begin{thebibliography}{99}
\\bibitem{smith2020} Smith, J. and Jones, K. (2020). Title A.
\\bibitem{jones2021} Jones, K. (2021). Title B.
\\bibitem{doe2019} Doe, A., Roe, B., and Smith, J. (2019). Title C.
\\end{thebibliography}
\\end{document}
`)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getCitation('smith2020')!.number).toBe(1)
    expect(labelRegistry.getCitation('jones2021')!.number).toBe(2)
    expect(labelRegistry.getCitation('doe2019')!.number).toBe(3)
    // Heuristic short-label extraction (best-effort).
    expect(labelRegistry.getCitation('jones2021')!.shortLabel).toContain('2021')
    expect(labelRegistry.getCitation('doe2019')!.shortLabel).toContain('et al.')
  })

  it('keeps bibitem anchors out of the \\label anchor namespace', async () => {
    // A theorem and a bibliography entry are allowed to share a name in
    // LaTeX. When both minted `latex-anchor-smith2020`, clicking the
    // citation scrolled to the theorem — whichever came first in the DOM.
    const { doc } = await parseLatexToDoc(`\\documentclass{article}
\\begin{document}
\\begin{theorem}\\label{smith2020}
A statement.
\\end{theorem}
We cite \\citep{smith2020}.
\\begin{thebibliography}{99}
\\bibitem{smith2020} Smith, J. (2020). Title A.
\\end{thebibliography}
\\end{document}
`)
    labelRegistry.rebuild(doc)
    const label = labelRegistry.getLabel('smith2020')
    const cite = labelRegistry.getCitation('smith2020')
    expect(label).toBeDefined()
    expect(cite).toBeDefined()
    expect(cite!.domAnchor).not.toBe(label!.domAnchor)
    expect(cite!.domAnchor).toBe('latex-cite-smith2020')
  })
})

describe('labelRegistry — floats and appendix', () => {
  it('numbers tables, algorithms and figures so \cref resolves them', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getLabel('tab:regression')).toMatchObject({
      kind: 'table',
      shortNumber: '1',
      pretty: 'Table 1'
    })
    expect(labelRegistry.getLabel('alg:cmd')).toMatchObject({
      kind: 'algorithm',
      shortNumber: '1',
      pretty: 'Algorithm 1'
    })
    expect(labelRegistry.getLabel('fig:convergence')).toMatchObject({
      kind: 'figure',
      shortNumber: '1',
      pretty: 'Figure 1'
    })
  })

  it('letters sections after \appendix', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    labelRegistry.rebuild(doc)
    // Before \appendix: ordinary numbering.
    expect(labelRegistry.getLabel('sec:intro')?.pretty).toBe('Section 1')
    // After it: "Appendix A", not "Section 6".
    expect(labelRegistry.getLabel('app:proofs')?.pretty).toBe('Appendix A')
  })
})
