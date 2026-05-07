import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { fixture, nodeOutline, firstOfType, flatText } from './helpers'

describe('parser — basics', () => {
  it('parses minimal section + paragraph', async () => {
    const { doc, documentClass } = await parseLatexToDoc(fixture('minimal.tex'))
    expect(documentClass).toBe('article')
    const section = firstOfType(doc, 'section')
    expect(section).not.toBeNull()
    expect(flatText(section!)).toContain('World.')
    expect(nodeOutline(doc)).toEqual([
      'preamble',
      'section',
      'sectionTitle',
      'paragraph'
    ])
  })

  it('captures the preamble verbatim and labels documentClass', async () => {
    const { doc, preamble, documentClass } = await parseLatexToDoc(`
\\documentclass[12pt]{book}
\\usepackage{amsmath}
\\title{x}
\\begin{document}
Body.
\\end{document}
`)
    // documentClass is the required arg of \documentclass; options live in
    // the preamble itself.
    expect(documentClass).toBe('book')
    expect(preamble).toContain('[12pt]')
    expect(preamble).toContain('\\usepackage{amsmath}')
    const preambleNode = firstOfType(doc, 'preamble')
    expect((preambleNode!.attrs.source as string)).toContain('\\documentclass')
  })

  it('handles a doc with no \\begin{document} by treating the whole input as body', async () => {
    const { doc } = await parseLatexToDoc('\\section{Loose}\nText.')
    const sec = firstOfType(doc, 'section')
    expect(sec).not.toBeNull()
    expect(flatText(sec!)).toContain('Text.')
  })
})
