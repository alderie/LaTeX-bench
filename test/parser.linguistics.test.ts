import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { allOfType, fixture, firstOfType, flatText } from './helpers'

describe('parser — linguistics paper (lingmacros + tree-dvips)', () => {
  it('parses without throwing on unknown lingmacros', async () => {
    await expect(parseLatexToDoc(fixture('linguistics-paper.tex'))).resolves.toBeDefined()
  })

  it('treats \\section* and \\subsection* as headings', async () => {
    const { doc } = await parseLatexToDoc(fixture('linguistics-paper.tex'))
    const sections = allOfType(doc, 'section')
    // 1 \section* (Notes…) + 2 \subsection* (How to…, Mood) = 3 nodes.
    expect(sections.length).toBe(3)
    const titles = sections.map((s) => {
      const t = firstOfType(s, 'sectionTitle')
      return t ? flatText(t) : ''
    })
    expect(titles).toContain('Notes for My Paper')
    expect(titles).toContain('How to handle topicalization')
    expect(titles).toContain('Mood')
  })

  it('captures \\enumsentence{…} as rawLatex blocks (verbatim source)', async () => {
    const { doc } = await parseLatexToDoc(fixture('linguistics-paper.tex'))
    const raws = allOfType(doc, 'rawLatex').map((n) => (n.attrs.source as string).trim())
    expect(raws.some((s) => s.startsWith('\\enumsentence'))).toBe(true)
    // Both enumsentence blocks survive with their tree-dvips internals.
    const both = raws.filter((s) => s.startsWith('\\enumsentence'))
    expect(both.length).toBe(2)
    expect(both.some((s) => s.includes('Topicalization from sentential subject'))).toBe(true)
    expect(both.some((s) => s.includes('Structure of A'))).toBe(true)
  })

  it('renders \\emph as an italic mark, not raw text', async () => {
    const { doc } = await parseLatexToDoc(fixture('linguistics-paper.tex'))
    const italics: string[] = []
    doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'em')) italics.push(n.text ?? '')
      return true
    })
    expect(italics).toContain('Irrealis')
    expect(italics).toContain('Realis')
    // And the macro name itself doesn't leak.
    expect(flatText(doc)).not.toContain('\\emph')
  })

  it('keeps the body text readable around the rawLatex islands', async () => {
    const { doc } = await parseLatexToDoc(fixture('linguistics-paper.tex'))
    const text = flatText(doc)
    expect(text).toContain("Don't forget to include examples of topicalization")
    expect(text).toContain("I'll just assume a tree structure")
    expect(text).toContain('Mood changes when there is a topic')
  })
})
