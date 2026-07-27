import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { firstOfType } from './helpers'

// An `\input`ed section file is body text with no `\begin{document}` of its
// own. The serializer used to wrap *everything* in a document environment,
// so opening one of these in the rich view and letting it save would put a
// second `\documentclass`-less document inside the paper and break the
// build. The preamble node now records which kind of file it came from.

const FRAGMENT = `\\section{Method}
We estimate $\\theta$ by maximum likelihood.

\\begin{equation}
  \\hat{\\theta} = \\arg\\max_\\theta L(\\theta).
\\end{equation}
`

const WHOLE = `\\documentclass{article}
\\begin{document}
\\section{Method}
Prose.
\\end{document}
`

describe('a file with no \\begin{document}', () => {
  it('is marked as a fragment', async () => {
    const { doc } = await parseLatexToDoc(FRAGMENT)
    expect(firstOfType(doc, 'preamble')?.attrs.fragment).toBe(true)
  })

  it('serializes back without a document environment', async () => {
    const { doc } = await parseLatexToDoc(FRAGMENT)
    const out = serializeDocToLatex(doc)
    expect(out).not.toContain('\\begin{document}')
    expect(out).not.toContain('\\end{document}')
    expect(out).toContain('\\section{Method}')
    expect(out).toContain('\\begin{equation}')
  })

  it('is a fixed point under a second round-trip', async () => {
    const once = serializeDocToLatex((await parseLatexToDoc(FRAGMENT)).doc)
    const twice = serializeDocToLatex((await parseLatexToDoc(once)).doc)
    expect(twice).toBe(once)
  })

  it('keeps its \\input lines intact', async () => {
    const tex = '\\input{sections/method}\n\nSome prose.\n'
    const out = serializeDocToLatex((await parseLatexToDoc(tex)).doc)
    expect(out).toContain('\\input{sections/method}')
    expect(out).not.toContain('\\begin{document}')
  })
})

describe('a whole document', () => {
  it('is not marked as a fragment', async () => {
    const { doc } = await parseLatexToDoc(WHOLE)
    expect(firstOfType(doc, 'preamble')?.attrs.fragment).toBe(false)
  })

  it('still round-trips with its document environment', async () => {
    const out = serializeDocToLatex((await parseLatexToDoc(WHOLE)).doc)
    expect(out).toContain('\\documentclass{article}')
    expect(out).toContain('\\begin{document}')
    expect(out).toContain('\\end{document}')
  })
})
