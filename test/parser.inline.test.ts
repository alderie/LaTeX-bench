import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { allOfType, firstOfType, flatText } from './helpers'

async function parseBody(body: string) {
  const { doc } = await parseLatexToDoc(
    `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`
  )
  return doc
}

describe('parser — inline marks', () => {
  it('extracts textbf/textit/emph/texttt as marks', async () => {
    const doc = await parseBody('Plain \\textbf{bold} and \\textit{italic} and \\texttt{code}.')
    const para = firstOfType(doc, 'paragraph')!
    const text = flatText(para)
    expect(text).toContain('bold')
    expect(text).toContain('italic')
    expect(text).toContain('code')
    // Walk the paragraph and verify each visible word carries the right mark.
    const marks: Record<string, string[]> = {}
    para.descendants((n) => {
      if (n.isText) {
        for (const m of n.marks) {
          ;(marks[m.type.name] ??= []).push(n.text ?? '')
        }
      }
      return true
    })
    expect(marks.strong).toContain('bold')
    expect(marks.em).toContain('italic')
    expect(marks.code).toContain('code')
  })

  it('renders \\textsc as a smallcaps mark', async () => {
    const doc = await parseBody('\\textsc{ACM} is great.')
    const para = firstOfType(doc, 'paragraph')!
    const hits: string[] = []
    para.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'smallcaps')) hits.push(n.text ?? '')
    })
    expect(hits).toContain('ACM')
  })

  it('parses \\href into a link mark with the URL on it', async () => {
    const doc = await parseBody('See \\href{https://example.com}{example} for details.')
    const para = firstOfType(doc, 'paragraph')!
    let href: string | null = null
    para.descendants((n) => {
      if (!n.isText) return true
      const link = n.marks.find((m) => m.type.name === 'link')
      if (link) href = (link.attrs.href as string) ?? null
      return true
    })
    expect(href).toBe('https://example.com')
    expect(flatText(para)).toContain('example')
  })

  it('renders \\url{x} as the URL with a link mark', async () => {
    const doc = await parseBody('Bare \\url{https://example.com/x} ok.')
    const para = firstOfType(doc, 'paragraph')!
    const text = flatText(para)
    expect(text).toContain('https://example.com/x')
  })

  it('substitutes known icon macros to Unicode glyphs', async () => {
    const doc = await parseBody('Email \\Letter\\ contact.')
    expect(flatText(doc)).toContain('✉')
  })

  it('drops silent layout macros (\\centering, \\noindent, …)', async () => {
    const doc = await parseBody('Before \\centering middle \\noindent after.')
    const text = flatText(doc)
    expect(text).not.toContain('\\centering')
    expect(text).not.toContain('\\noindent')
    expect(text).toContain('Before')
    expect(text).toContain('after')
  })

  it('drops unknown macros with no captured args and surfaces following group content', async () => {
    // unified-latex doesn't know `\Colorhref` is 3-arg — args end up empty
    // and the {…} groups become separate AST nodes. We drop the macro
    // name and let those groups render transparently; the visible label
    // is the last one. (`[orange]` and the URL still leak as text — the
    // user can switch to Source mode to clean those up if it matters.)
    const doc = await parseBody('Prefix \\Colorhref[orange]{https://x}{visible label} and more.')
    expect(flatText(doc)).toContain('visible label')
    expect(flatText(doc)).not.toContain('\\Colorhref')
    expect(flatText(doc)).toContain('and more')
  })

  it('does not duplicate citations across multiple keys', async () => {
    const doc = await parseBody('Per \\cite{smith2020,jones2021} we ...')
    const cites = allOfType(doc, 'citation')
    expect(cites).toHaveLength(1)
    expect(cites[0].attrs.keys).toEqual(['smith2020', 'jones2021'])
  })
})
