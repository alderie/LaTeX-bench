import { describe, it, expect } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { fixture, nodeOutline } from './helpers'

// Round-trip tests assert that the document **structure** is invariant
// under a parse → serialize → parse cycle. We deliberately don't compare
// the latex/source attribute contents byte-for-byte — unified-latex's
// `printRaw` lightly normalizes whitespace inside math, so two passes
// converge on a stable form rather than reproducing the input exactly.
//
// What we DO check:
//   - Same node-type outline (so structural data isn't lost / reshuffled)
//   - Same number of math blocks, sections, citations, links, …
//   - Specific attributes that matter for editing (link href, citation
//     keys, section level/title)

async function passes(input: string): Promise<{ doc1: PMNode; doc2: PMNode; tex2: string }> {
  const { doc: doc1 } = await parseLatexToDoc(input)
  const tex2 = serializeDocToLatex(doc1)
  const { doc: doc2 } = await parseLatexToDoc(tex2)
  return { doc1, doc2, tex2 }
}

describe('round-trip — structural stability', () => {
  it('minimal section + paragraph keeps same outline', async () => {
    const { doc1, doc2 } = await passes(fixture('minimal.tex'))
    expect(nodeOutline(doc2)).toEqual(nodeOutline(doc1))
  })

  it('inline-styles fixture keeps same outline', async () => {
    const { doc1, doc2 } = await passes(fixture('inline-styles.tex'))
    expect(nodeOutline(doc2)).toEqual(nodeOutline(doc1))
  })

  it('math fixture keeps the same number of math blocks and inline math', async () => {
    const { doc1, doc2 } = await passes(fixture('math.tex'))
    const count = (doc: PMNode, type: string): number => {
      let n = 0
      doc.descendants((node) => {
        if (node.type.name === type) n++
        return true
      })
      return n
    }
    expect(count(doc2, 'mathBlock')).toBe(count(doc1, 'mathBlock'))
    expect(count(doc2, 'mathInline')).toBe(count(doc1, 'mathInline'))
  })

  it('preserves \\href URL through round-trip', async () => {
    const { doc: d1 } = await parseLatexToDoc(`
\\documentclass{article}
\\begin{document}
See \\href{https://example.com/x}{the docs}.
\\end{document}
`)
    const tex2 = serializeDocToLatex(d1)
    expect(tex2).toContain('\\href{https://example.com/x}{the docs}')
    const { doc: d2 } = await parseLatexToDoc(tex2)
    let href: string | null = null
    d2.descendants((n) => {
      if (n.isText) {
        const link = n.marks.find((m) => m.type.name === 'link')
        if (link) href = link.attrs.href as string
      }
      return true
    })
    expect(href).toBe('https://example.com/x')
  })

  it('preserves rawLatex blocks verbatim', async () => {
    const { doc: d1 } = await parseLatexToDoc(`
\\documentclass{article}
\\begin{document}
\\maketitle
\\section{X}
Body.
\\end{document}
`)
    const tex2 = serializeDocToLatex(d1)
    expect(tex2).toContain('\\maketitle')
  })

  it('preserves citations and their keys', async () => {
    const { doc: d1, tex2, doc2: _ } = await passes(`
\\documentclass{article}
\\begin{document}
We \\cite{smith2020,jones2021,doe} cite multiple keys.
\\end{document}
`)
    expect(tex2).toContain('\\cite{smith2020,jones2021,doe}')
  })
})
