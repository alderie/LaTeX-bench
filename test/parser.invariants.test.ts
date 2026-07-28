import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { fixture } from './helpers'
import {
  bibitemKeys,
  braceBalance,
  citeKeys,
  environmentBalance,
  environmentCensus,
  fatalConstructs,
  labels,
  verbSpans,
  verbatimBodies
} from './latex-invariants'

// What has to be true of every document the editor touches.
//
// The rich view rewrites the whole `.tex` on every transaction, so a parse
// bug is not a rendering glitch — it is a silent edit to the user's file,
// applied the moment they type a character. These run the same battery over
// every fixture, so a construct nobody wrote a test for still has to survive.

const FIXTURES = [
  'minimal.tex',
  'math.tex',
  'inline-styles.tex',
  'containers.tex',
  'moderncv-cv.tex',
  'analysis-formelsammlung.tex',
  'linguistics-paper.tex',
  'heavy-tail-paper.tex',
  'kitchen-sink.tex',
  'torture.tex'
]

async function roundtrip(tex: string): Promise<string> {
  return serializeDocToLatex((await parseLatexToDoc(tex)).doc)
}

describe.each(FIXTURES)('%s', (name) => {
  it('stays a fixed point under repeated saves', async () => {
    // Typing one character rewrites the file. If the second save differs
    // from the first, the document drifts for as long as it is open.
    const once = await roundtrip(fixture(name))
    const twice = await roundtrip(once)
    expect(twice).toBe(once)
  })

  it('comes back with balanced braces', async () => {
    const out = await roundtrip(fixture(name))
    const balance = braceBalance(out)
    expect(
      balance.balanced,
      `brace depth ended at ${balance.depth}` +
        (balance.firstUnderflow !== null
          ? `; first stray '}' near: ${out.slice(Math.max(0, balance.firstUnderflow - 60), balance.firstUnderflow + 20)}`
          : '')
    ).toBe(true)
  })

  it('comes back with every environment closed by its own name', async () => {
    const out = await roundtrip(fixture(name))
    const balance = environmentBalance(out)
    expect(balance.balanced, balance.problem ?? '').toBe(true)
  })

  it('keeps every \\label', async () => {
    const source = fixture(name)
    expect(labels(await roundtrip(source))).toEqual(labels(source))
  })

  it('keeps every citation key', async () => {
    const source = fixture(name)
    expect(citeKeys(await roundtrip(source))).toEqual(citeKeys(source))
  })

  it('keeps every \\bibitem', async () => {
    const source = fixture(name)
    expect(bibitemKeys(await roundtrip(source))).toEqual(bibitemKeys(source))
  })

  it('keeps every environment, and the same number of each', async () => {
    const source = fixture(name)
    expect(environmentCensus(await roundtrip(source))).toEqual(environmentCensus(source))
  })

  it('keeps verbatim bodies byte for byte', async () => {
    // A reflowed line inside `verbatim` or `lstlisting` changes what the
    // document prints, which is the one thing verbatim promises not to do.
    const source = fixture(name)
    expect(verbatimBodies(await roundtrip(source))).toEqual(verbatimBodies(source))
  })

  it('keeps \\verb spans byte for byte', async () => {
    const source = fixture(name)
    expect(verbSpans(await roundtrip(source))).toEqual(verbSpans(source))
  })

  it('produces nothing that would fail to compile', async () => {
    const out = await roundtrip(fixture(name))
    expect(fatalConstructs(out)).toEqual([])
  })
})

describe('the invariants themselves', () => {
  // A test battery that cannot fail is worse than none, so each check is
  // shown catching the thing it is there to catch.

  it('brace balance notices an extra closer', () => {
    expect(braceBalance('\\section{ok}').balanced).toBe(true)
    expect(braceBalance('\\section{ok}}').balanced).toBe(false)
    expect(braceBalance('\\section{ok').balanced).toBe(false)
  })

  it('brace balance ignores escaped braces and comments', () => {
    expect(braceBalance('literal \\{ and \\} alone').balanced).toBe(true)
    expect(braceBalance('text % a stray { in a comment\n').balanced).toBe(true)
  })

  it('brace balance ignores braces inside verbatim', () => {
    expect(braceBalance('\\begin{verbatim}\n{ unbalanced\n\\end{verbatim}').balanced).toBe(true)
    expect(braceBalance('\\verb|{|').balanced).toBe(true)
  })

  it('environment balance notices a mismatch', () => {
    expect(environmentBalance('\\begin{a}\\end{a}').balanced).toBe(true)
    expect(environmentBalance('\\begin{a}\\end{b}').problem).toContain('closes')
    expect(environmentBalance('\\begin{a}').problem).toContain('never closed')
    expect(environmentBalance('\\end{a}').problem).toContain('no \\begin')
  })

  it('environment balance is not fooled by a verbatim body', () => {
    // torture.tex contains exactly this.
    const tex = '\\begin{verbatim}\n\\begin{document}\n\\end{verbatim}'
    expect(environmentBalance(tex).balanced).toBe(true)
  })

  it('cite keys are flattened out of lists and optional arguments', () => {
    expect(citeKeys('\\cite{a,b} \\cite[Ch.~3]{c} \\citep{a}')).toEqual(['a', 'b', 'c'])
  })

  it('the environment census counts repeats', () => {
    const tex = '\\begin{align}\\end{align}\\begin{align}\\end{align}\\begin{table}\\end{table}'
    expect(environmentCensus(tex)).toEqual({ align: 2, table: 1 })
  })

  it('fatal constructs catches a spec-less tabular', () => {
    expect(fatalConstructs('\\begin{tabular}\\toprule a \\\\\\end{tabular}')).toHaveLength(1)
    expect(fatalConstructs('\\begin{tabular}{lc}a & b\\\\\\end{tabular}')).toEqual([])
    expect(fatalConstructs('\\begin{tabular}[t]{lc}a & b\\\\\\end{tabular}')).toEqual([])
  })

  it('fatal constructs catches a spilled key list', () => {
    expect(fatalConstructs('see \\cite{}knuth1984 for more')).toHaveLength(1)
    expect(fatalConstructs('see \\cite{knuth1984} for more')).toEqual([])
  })

  it('fatal constructs catches a section with no argument', () => {
    expect(fatalConstructs('\\section\nText')).toHaveLength(1)
    expect(fatalConstructs('\\section{Fine}')).toEqual([])
    expect(fatalConstructs('\\section[Short]{Fine}')).toEqual([])
  })

  it('verb spans are extracted with their delimiters', () => {
    expect(verbSpans('a \\verb|x{y| b \\verb+p|q+ c')).toEqual(['\\verb|x{y|', '\\verb+p|q+'])
  })
})
