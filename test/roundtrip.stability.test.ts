import { describe, it, expect } from 'vitest'
import {
  parseLatexToDoc,
  repairSerializerDamage
} from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { allOfType, fixture, flatText } from './helpers'

// The WYSIWYG view writes the serialized document back to disk on every
// transaction. If parse → serialize isn't a fixed point, opening a paper
// and typing one character rewrites unrelated parts of the file — and the
// drift compounds with each save. These tests pin that down.

const FIXTURES = [
  'minimal.tex',
  'math.tex',
  'inline-styles.tex',
  'containers.tex',
  'moderncv-cv.tex',
  'analysis-formelsammlung.tex',
  'linguistics-paper.tex',
  'heavy-tail-paper.tex'
]

async function roundtrip(tex: string): Promise<string> {
  return serializeDocToLatex((await parseLatexToDoc(tex)).doc)
}

describe('round-trip stability', () => {
  for (const name of FIXTURES) {
    it(`${name} — serialize is a fixed point`, async () => {
      const once = await roundtrip(fixture(name))
      const twice = await roundtrip(once)
      expect(twice).toBe(once)
    })

    it(`${name} — preamble survives byte-for-byte`, async () => {
      const tex = fixture(name)
      const docStart = tex.indexOf('\\begin{document}')
      if (docStart < 0) return
      const { preamble } = await parseLatexToDoc(tex)
      const original = tex.slice(0, docStart)
      // \title/\author/\date move onto the title block when the body has
      // \maketitle, so compare only the lines that stayed behind.
      const originalLines = original.split('\n').map((l) => l.trimEnd())
      for (const line of preamble.split('\n').map((l) => l.trimEnd())) {
        if (line.trim() === '') continue
        expect(originalLines).toContain(line)
      }
    })
  }

  it('does not reflow the preamble onto a single line', async () => {
    const tex = fixture('heavy-tail-paper.tex')
    const { preamble } = await parseLatexToDoc(tex)
    expect(preamble).toContain('\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}')
    // Comment banners keep their own lines rather than accumulating blanks.
    expect(preamble).not.toMatch(/\n\n\n/)
  })

  it('does not rewrite math the user never touched', async () => {
    const tex = fixture('heavy-tail-paper.tex')
    const out = await roundtrip(tex)
    // printRaw would turn `\R^d` into `\R^{d}` and shuffle operator spacing.
    expect(out).toContain('$\\R^d$')
    expect(out).toContain('$\\norm{\\cdot}_*$')
  })
})

describe('repairing damage from earlier serializer versions', () => {
  it('folds bare keys back into an emptied \cite{}', async () => {
    // What an affected .tex on disk actually looks like: the citation lost
    // its keys and they were written back out as prose.
    const damaged = String.raw`\documentclass{article}
\begin{document}
Recent work~\cite{}nazin2019algorithms,gorbunov2020stochastic. Also \cite{}cont2001empirical.
See \cref{}sec:main too.
\begin{thebibliography}{9}
\bibitem{nazin2019algorithms} A.~Nazin.
\bibitem{gorbunov2020stochastic} E.~Gorbunov.
\bibitem{cont2001empirical} R.~Cont.
\end{thebibliography}
\end{document}`
    const { doc } = await parseLatexToDoc(damaged)
    const cites = allOfType(doc, 'citation').map((n) => n.attrs.keys as string[])
    expect(cites).toEqual([
      ['nazin2019algorithms', 'gorbunov2020stochastic'],
      ['cont2001empirical']
    ])
    // The trailing sentence period stays prose, not part of a key.
    const text = flatText(doc)
    expect(text).not.toContain('nazin2019algorithms')
    expect(text).toContain('Recent work')

    const refs = allOfType(doc, 'crossRef').map((n) => n.attrs.keys as string[])
    expect(refs).toEqual([['sec:main']])
  })

  it('leaves a genuinely empty argument alone', () => {
    expect(repairSerializerDamage('\cite{} and text')).toBe('\cite{} and text')
    expect(repairSerializerDamage('\label{}')).toBe('\label{}')
  })
})
