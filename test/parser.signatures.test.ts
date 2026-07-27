import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { signaturesFromPreamble } from '@renderer/editor/wysiwyg/latex-signatures'
import { allOfType, flatText } from './helpers'

// LaTeX can't be parsed without knowing each macro's argument shape. These
// tests pin the signature layer that supplies it — both the standard table
// and the signatures read out of a document's own \newcommand definitions.

describe('signatures from the document preamble', () => {
  it('reads argument counts and optional-argument defaults', () => {
    const sigs = signaturesFromPreamble(String.raw`
\documentclass{article}
\newcommand{\note}[1]{\textit{#1}}
\newcommand{\todo}[2][red]{\textcolor{#1}{#2}}
\renewcommand\shorthand[3]{#1#2#3}
\providecommand{\plain}{x}
\begin{document}
`)
    expect(sigs.note).toEqual({ signature: 'm' })
    expect(sigs.todo).toEqual({ signature: 'o m' })
    expect(sigs.shorthand).toEqual({ signature: 'm m m' })
    // Zero-argument macros need no signature.
    expect(sigs.plain).toBeUndefined()
  })

  it('never lets a document shadow a standard signature', () => {
    const sigs = signaturesFromPreamble(String.raw`\newcommand{\cite}[1]{[#1]}`)
    expect(sigs.cite).toBeUndefined()
  })

  it('ignores definitions after \\begin{document}', () => {
    const sigs = signaturesFromPreamble(String.raw`
\documentclass{article}
\begin{document}
\begin{verbatim}
\newcommand{\notreal}[2]{...}
\end{verbatim}
`)
    expect(sigs.notreal).toBeUndefined()
  })
})

describe('signatures applied during parse', () => {
  it("keeps a document macro's optional argument out of the prose", async () => {
    const { doc, preamble } = await parseLatexToDoc(String.raw`\documentclass{article}
\usepackage{xcolor}
\newcommand{\todo}[2][red]{\textcolor{#1}{\textbf{TODO:} #2}}
\begin{document}
A sentence \todo[blue]{fix the bound} continues here.
\end{document}
`)
    expect(preamble).toContain('\\newcommand{\\todo}')
    const text = flatText(doc)
    // Without the derived signature, `[blue]` rendered as literal text.
    expect(text).not.toContain('[blue]')
    expect(text).toContain('A sentence')
    expect(text).toContain('continues here.')
  })

  it('parses natbib pre/post notes on every cite command', async () => {
    const { doc } = await parseLatexToDoc(String.raw`\documentclass{article}
\begin{document}
See \citet[cf.][ch.~2]{a} and \parencite[p.~7]{b}.
\end{document}
`)
    const cites = allOfType(doc, 'citation')
    expect(cites.map((c) => c.attrs.cmd)).toEqual(['citet', 'parencite'])
    expect(cites[0].attrs.prenote).toBe('cf.')
    expect(cites[0].attrs.postnote).toBe('ch.~2')
    expect(cites[1].attrs.prenote).toBeNull()
    expect(cites[1].attrs.postnote).toBe('p.~7')
  })

  it('keeps environment arguments attached to the environment', async () => {
    const { doc, tex } = await (async () => {
      const parsed = await parseLatexToDoc(String.raw`\documentclass{article}
\begin{document}
\begin{figure}
\begin{minipage}[t]{0.5\linewidth}
Left column.
\end{minipage}
\end{figure}
\end{document}
`)
      return { doc: parsed.doc, tex: serializeDocToLatex(parsed.doc) }
    })()
    const minipage = allOfType(doc, 'floatBlock').find((n) => n.attrs.kind === 'minipage')
    expect(minipage).toBeDefined()
    expect(minipage!.attrs.args).toBe('[t]{0.5\\linewidth}')
    expect(flatText(minipage!)).not.toContain('0.5')
    expect(tex).toContain('\\begin{minipage}[t]{0.5\\linewidth}')
  })
})
