import { describe, it, expect } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import * as labelRegistry from '@renderer/editor/wysiwyg/labelRegistry'
import { allOfType, firstOfType, fixture, flatText } from './helpers'

// Conformance suite for test/fixtures/kitchen-sink.tex.
//
// Every assertion here corresponds to a construct that used to be dropped,
// reordered, or rewritten into invalid LaTeX. The fixture is a torture test
// rather than a realistic paper — see its header comment.

let cached: { doc: PMNode; tex: string } | null = null

async function parsed(): Promise<{ doc: PMNode; tex: string }> {
  if (!cached) {
    const { doc } = await parseLatexToDoc(fixture('kitchen-sink.tex'))
    cached = { doc, tex: serializeDocToLatex(doc) }
  }
  return cached
}

describe('kitchen sink — text-mode escapes and symbols', () => {
  it('renders escaped reserved characters as the characters themselves', async () => {
    const { doc } = await parsed()
    const text = flatText(doc)
    expect(text).toContain('100% of $5 costs #1 in the Smith & Jones')
    expect(text).toContain('report_final')
    expect(text).toContain('{like this}')
    // The literal macro name must never surface as visible text.
    expect(text).not.toContain('\\%')
    expect(text).not.toContain('\\textbackslash')
  })

  it('composes accent macros into single characters', async () => {
    const { doc } = await parsed()
    const text = flatText(doc)
    for (const word of ['René', 'Müller', 'François', 'Ångström', 'Erdős', 'Ørsted', 'straße', 'naïve']) {
      expect(text).toContain(word)
    }
  })

  it('writes accents back as escapes that compile', async () => {
    const { tex } = await parsed()
    expect(tex).toContain("Fran\\c{c}ois")
    expect(tex).toContain('stra\\ss{}e')
    // The old behaviour glued the accent to its argument and produced
    // undefined control sequences.
    for (const corrupt of ['\\ccois', '\\AAngstr', '\\Hos', '\\Orsted', '\\sse', '\\"om']) {
      expect(tex).not.toContain(corrupt)
    }
  })

  it('keeps a bare macro from swallowing the space after it', async () => {
    const { tex } = await parsed()
    expect(tex).toContain('\\LaTeX{} Round-Tripping')
  })

  it('does not grow escape sequences on repeated saves', async () => {
    const { tex } = await parsed()
    // `\textbackslash{}` re-escaping its own braces used to add two
    // characters per save.
    expect(tex).toContain('\\textbackslash{} plus a tilde')
    expect(tex).not.toContain('\\textbackslash\\{\\}')
  })

  it('models \\textsuperscript / \\textsubscript as marks, not lost wrappers', async () => {
    const { doc, tex } = await parsed()
    const marks = new Set<string>()
    doc.descendants((n) => {
      for (const m of n.marks) marks.add(m.type.name)
      return true
    })
    expect(marks.has('superscript')).toBe(true)
    expect(marks.has('subscript')).toBe(true)
    expect(tex).toContain('3\\textsuperscript{rd}')
    expect(tex).toContain('H\\textsubscript{2}O')
  })

  it('keeps \\verb bodies literal', async () => {
    const { tex } = await parsed()
    expect(tex).toContain('\\verb|x <- y|')
    expect(tex).toContain('\\verb+a & b+')
  })
})

describe('kitchen sink — citations and cross-references', () => {
  it('parses natbib pre/post notes instead of leaking them as text', async () => {
    const { doc, tex } = await parsed()
    const withNotes = allOfType(doc, 'citation').find((n) => n.attrs.prenote !== null)
    expect(withNotes).toBeDefined()
    expect(withNotes!.attrs.prenote).toBe('see')
    expect(withNotes!.attrs.postnote).toBe('p.~42')
    expect(withNotes!.attrs.keys).toEqual(['boyd2004convex'])
    expect(tex).toContain('\\citep[see][p.~42]{boyd2004convex}')
    // The signature-less parse used to emit this corruption.
    expect(tex).not.toContain('\\citep{}')
  })

  it('keeps every cite command distinct', async () => {
    const { tex } = await parsed()
    expect(tex).toContain('\\cite{knuth1984texbook}')
    expect(tex).toContain('\\citet{nesterov2018lectures}')
    expect(tex).toContain('\\citep{boyd2004convex,nesterov2018lectures}')
  })

  it('resolves references into floats, theorems and equations', async () => {
    const { doc } = await parsed()
    labelRegistry.rebuild(doc)
    const registry = labelRegistry.getState()
    expect(registry.byKey.get('tab:results')?.kindLabel).toBe('Table')
    expect(registry.byKey.get('fig:panels')?.kindLabel).toBe('Figure')
    expect(registry.byKey.get('thm:rate')?.pretty).toMatch(/^Theorem /)
    expect(registry.byKey.get('def:strong')?.pretty).toMatch(/^Definition /)
    expect(registry.byKey.get('eq:objective')?.eqrefText).toBe('(1)')
  })

  it('letters the lines of a subequations group', async () => {
    const { doc } = await parsed()
    labelRegistry.rebuild(doc)
    const registry = labelRegistry.getState()
    // The group takes one number; its lines get (Na), (Nb), (Nc).
    const group = registry.byKey.get('eq:system')?.shortNumber
    expect(group).toBeDefined()
    expect(registry.byKey.get('eq:lorenz-x')?.shortNumber).toBe(`${group}a`)
    expect(registry.byKey.get('eq:lorenz-y')?.shortNumber).toBe(`${group}b`)
    expect(registry.byKey.get('eq:lorenz-z')?.shortNumber).toBe(`${group}c`)
  })
})

describe('kitchen sink — block structure', () => {
  it('keeps a nested list inside its parent item', async () => {
    const { doc, tex } = await parsed()
    const outer = allOfType(doc, 'listBlock').find((n) => n.attrs.kind === 'enumerate')
    expect(outer).toBeDefined()
    const nested = allOfType(outer!, 'listBlock')
    expect(nested.length).toBe(1)
    expect(nested[0].attrs.kind).toBe('itemize')
    expect(flatText(nested[0])).toContain('An inner bullet.')
    // …and writes it back inside the item, not after the outer list.
    expect(tex).toMatch(/A second outer item with an inner list:[\s\S]*?\\begin\{itemize\}[\s\S]*?\\end\{itemize\}[\s\S]*?\\item A third outer item/)
  })

  it('keeps both paragraphs of a multi-paragraph item', async () => {
    const { doc } = await parsed()
    const item = allOfType(doc, 'listItem').find((n) =>
      flatText(n).includes('First paragraph of the item')
    )
    expect(item).toBeDefined()
    expect(allOfType(item!, 'paragraph').length).toBe(2)
    expect(flatText(item!)).toContain('Second paragraph of the same item')
  })

  it('preserves enumitem options and description terms', async () => {
    const { doc, tex } = await parsed()
    const enumerate = allOfType(doc, 'listBlock').find((n) => n.attrs.kind === 'enumerate')
    expect(enumerate!.attrs.options).toBe('label=(\\roman*)')
    const markers = allOfType(doc, 'listItem')
      .map((n) => n.attrs.marker)
      .filter(Boolean)
    expect(markers).toContain('Convex')
    expect(markers).toContain('Smooth')
    expect(tex).toContain('\\item[Convex]')
  })

  it('captures theorem titles', async () => {
    const { doc, tex } = await parsed()
    const titles = allOfType(doc, 'theoremEnv').map((n) => n.attrs.title)
    expect(titles).toContain('Strong convexity')
    expect(titles).toContain('Convergence rate')
    expect(tex).toContain('\\begin{theorem}[Convergence rate]')
  })

  it('keeps a caption above the tabular the author put it above', async () => {
    const { doc, tex } = await parsed()
    const table = allOfType(doc, 'floatBlock').find((n) => n.attrs.label === 'tab:results')
    expect(table).toBeDefined()
    // caption first, tabular second — the order in the fixture.
    expect(table!.firstChild!.type.name).toBe('caption')
    const captionAt = tex.indexOf('Booktabs table with a')
    const tabularAt = tex.indexOf('\\begin{tabular}{@{}llrr@{}}')
    expect(captionAt).toBeGreaterThan(-1)
    expect(captionAt).toBeLessThan(tabularAt)
    // …and the other table's caption stays below its tabular.
    const notationCaption = tex.indexOf('\\caption{Notation.}')
    const notationTabular = tex.indexOf('\\begin{tabular}{|l|c|}')
    expect(notationCaption).toBeGreaterThan(notationTabular)
  })

  it('writes \\label after the \\caption it belongs to', async () => {
    const { tex } = await parsed()
    const caption = tex.indexOf('\\caption{Notation.}')
    const label = tex.indexOf('\\label{tab:notation}')
    expect(label).toBeGreaterThan(caption)
  })

  it('keeps subfigure width arguments out of the body text', async () => {
    const { doc, tex } = await parsed()
    const subfigures = allOfType(doc, 'floatBlock').filter((n) => n.attrs.kind === 'subfigure')
    expect(subfigures.length).toBe(2)
    expect(subfigures[0].attrs.args).toBe('[b]{0.45\\linewidth}')
    // The width used to be dropped from the environment and rendered as the
    // literal paragraph "0.45\linewidth".
    expect(flatText(subfigures[0])).not.toContain('0.45')
    expect(tex).toContain('\\begin{subfigure}[b]{0.45\\linewidth}')
  })

  it('treats every amsmath display environment as math', async () => {
    const { doc } = await parsed()
    const latexOf = allOfType(doc, 'mathBlock').map((n) => n.attrs.latex as string)
    expect(latexOf.some((l) => l.includes('\\begin{alignat}'))).toBe(true)
    expect(latexOf.some((l) => l.includes('\\begin{subequations}'))).toBe(true)
    expect(latexOf.some((l) => l.includes('\\begin{gather*}'))).toBe(true)
    // …and none of them fell through to an opaque raw block.
    const raw = allOfType(doc, 'rawLatex').map((n) => n.attrs.source as string)
    expect(raw.some((r) => r.includes('\\begin{alignat}'))).toBe(false)
    expect(raw.some((r) => r.includes('\\begin{subequations}'))).toBe(false)
  })

  it('keeps verbatim bodies byte-exact', async () => {
    const { doc, tex } = await parsed()
    const code = allOfType(doc, 'codeBlock')
    expect(code.length).toBe(2)
    expect(code[0].attrs.code).toBe(
      'def f(x):\n    # a comment with $math$ and \\backslash\n    return x ** 2'
    )
    expect(code[1].attrs.language).toBe('Python')
    expect(tex).toContain('    print(i)   # 100% literal')
  })

  it('parses the bibliography into editable entries', async () => {
    const { doc } = await parsed()
    const bib = firstOfType(doc, 'bibliography')
    expect(bib).not.toBeNull()
    const keys = allOfType(bib!, 'bibitem').map((n) => n.attrs.key)
    expect(keys).toEqual(['boyd2004convex', 'knuth1984texbook', 'nesterov2018lectures'])
  })
})

describe('kitchen sink — round-trip', () => {
  it('is a fixed point after one pass', async () => {
    const { tex } = await parsed()
    const { doc: doc2 } = await parseLatexToDoc(tex)
    expect(serializeDocToLatex(doc2)).toBe(tex)
  })

  it('never emits a macro glued to the text after it', async () => {
    const { tex } = await parsed()
    // Catches the `\textsuperscriptrd` class of corruption: an
    // argument-taking macro whose argument braces went missing, leaving it
    // glued to the following letters.
    for (const macro of ['textsuperscript', 'textsubscript', 'textbackslash', 'textasciitilde']) {
      expect(tex).not.toMatch(new RegExp(`\\\\${macro}[a-zA-Z]`))
    }
  })
})
