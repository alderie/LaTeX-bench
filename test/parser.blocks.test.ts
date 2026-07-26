import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { fixture, allOfType, firstOfType, flatText, nodeOutline } from './helpers'

describe('parser — block-level macros', () => {
  it('promotes \\maketitle to a titleBlock and keeps \\tableofcontents as rawLatex', async () => {
    const { doc } = await parseLatexToDoc(`
\\documentclass{article}
\\title{X}
\\begin{document}
\\maketitle
\\tableofcontents
\\section{Intro}
Body.
\\end{document}
`)
    const raws = allOfType(doc, 'rawLatex')
    const sources = raws.map((r) => (r.attrs.source as string).trim())
    // \maketitle now lifts the title metadata out of the preamble into
    // an editable titleBlock node — it is no longer a rawLatex block.
    expect(allOfType(doc, 'titleBlock')).toHaveLength(1)
    expect(sources).toContain('\\tableofcontents')
    // Should NOT have leaked as paragraph text.
    expect(flatText(doc)).not.toContain('\\maketitle')
    expect(flatText(doc)).not.toContain('\\tableofcontents')
  })

  it('promotes consecutive \\title \\author \\date macros to separate rawLatex blocks', async () => {
    const { doc } = await parseLatexToDoc(`
\\documentclass{article}
\\begin{document}
\\title{Analysis Formelsammlung}
\\author{Peter Merkert, Martin Thoma}
\\date{21. Februar 2012}
\\section{Body}
Hello.
\\end{document}
`)
    const raws = allOfType(doc, 'rawLatex')
    expect(raws.length).toBeGreaterThanOrEqual(3)
    const sources = raws.map((r) => (r.attrs.source as string).trim()).join(' | ')
    expect(sources).toContain('\\title{Analysis Formelsammlung}')
    expect(sources).toContain('\\author{Peter Merkert, Martin Thoma}')
    expect(sources).toContain('\\date{21. Februar 2012}')
    // None of the metadata leaked into a paragraph as text.
    expect(flatText(doc)).not.toContain('Peter Merkert, Martin Thoma')
  })

  it('captures moderncv \\cventry / \\cvitem as rawLatex blocks', async () => {
    const { doc } = await parseLatexToDoc(fixture('moderncv-cv.tex'))
    const raws = allOfType(doc, 'rawLatex').map((r) => (r.attrs.source as string).trim())
    expect(raws.some((s) => s.startsWith('\\cventry'))).toBe(true)
    expect(raws.some((s) => s.startsWith('\\cvitem'))).toBe(true)
    expect(raws.some((s) => s.startsWith('\\makecvtitle'))).toBe(true)
  })

  it('builds a section hierarchy with sub-sections nested inside sections', async () => {
    const { doc } = await parseLatexToDoc(`
\\documentclass{article}
\\begin{document}
\\section{Outer}
A.
\\subsection{Inner}
B.
\\section{Sibling}
C.
\\end{document}
`)
    const sections = allOfType(doc, 'section')
    expect(sections.length).toBe(3) // Outer, Inner, Sibling
    // Outer should contain Inner; outline should show that nesting.
    const outline = nodeOutline(doc)
    const firstSectionIdx = outline.indexOf('section')
    const secondSectionIdx = outline.indexOf('section', firstSectionIdx + 1)
    expect(secondSectionIdx).toBeGreaterThan(firstSectionIdx)
  })
})

describe('parser — environments', () => {
  it('extracts equation/align as mathBlock nodes', async () => {
    const { doc } = await parseLatexToDoc(fixture('math.tex'))
    const blocks = allOfType(doc, 'mathBlock')
    expect(blocks.length).toBeGreaterThanOrEqual(3) // equation, align*, \[...\]
    const sources = blocks.map((b) => b.attrs.latex as string)
    expect(sources.some((s) => s.includes('\\begin{equation}'))).toBe(true)
    expect(sources.some((s) => s.includes('\\begin{align*}'))).toBe(true)
    expect(sources.some((s) => s.includes('\\['))).toBe(true)
  })

  it('extracts inline math as mathInline atoms', async () => {
    const { doc } = await parseLatexToDoc(fixture('math.tex'))
    const inlines = allOfType(doc, 'mathInline')
    expect(inlines.length).toBeGreaterThanOrEqual(1)
    const latex = inlines.map((n) => n.attrs.latex as string).join(' ')
    expect(latex).toContain('\\alpha')
  })

  it('recurses into table/minipage container envs to expose inner math', async () => {
    const { doc } = await parseLatexToDoc(fixture('containers.tex'))
    const blocks = allOfType(doc, 'mathBlock')
    expect(blocks.length).toBe(2) // one per minipage
  })

  it('keeps unknown envs as opaque rawLatex blocks (round-trippable)', async () => {
    const { doc } = await parseLatexToDoc(`
\\documentclass{article}
\\begin{document}
\\begin{tabular}{ll}
A & B \\\\
\\end{tabular}
\\end{document}
`)
    const raws = allOfType(doc, 'rawLatex')
    expect(raws.some((r) => (r.attrs.source as string).includes('\\begin{tabular}'))).toBe(true)
  })
})
