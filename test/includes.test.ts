import { describe, it, expect } from 'vitest'
import { extractIncludes, texPathFor } from '@renderer/editor/includes'

// Finding the other half of a paper: the files `main.tex` pulls in.

describe('texPathFor', () => {
  it('supplies the extension TeX would', () => {
    expect(texPathFor('sections/method')).toBe('sections/method.tex')
  })

  it('leaves an explicit extension alone', () => {
    expect(texPathFor('sections/method.tex')).toBe('sections/method.tex')
  })

  it('strips a leading ./', () => {
    expect(texPathFor('./intro')).toBe('intro.tex')
  })

  it('refuses to climb out of the paper folder', () => {
    expect(texPathFor('../../../etc/passwd')).toBeNull()
    expect(texPathFor('sections/../../secret')).toBeNull()
  })

  it('gives up on a path computed at compile time', () => {
    // `\input{\jobname-body}` can't be resolved without running TeX.
    expect(texPathFor('\\jobname-body')).toBeNull()
    expect(texPathFor('chapter#1')).toBeNull()
  })

  it('rejects an empty argument', () => {
    expect(texPathFor('')).toBeNull()
    expect(texPathFor('   ')).toBeNull()
  })
})

describe('extractIncludes', () => {
  it('finds \\input and \\include, in source order', () => {
    const tex = ['\\input{preamble-extra}', 'Prose.', '\\include{sections/results}'].join('\n')
    const refs = extractIncludes(tex)
    expect(refs.map((r) => r.path)).toEqual(['preamble-extra.tex', 'sections/results.tex'])
    expect(refs.map((r) => r.macro)).toEqual(['input', 'include'])
    expect(refs.map((r) => r.line)).toEqual([0, 2])
  })

  it('keeps the argument as written alongside the resolved path', () => {
    const [ref] = extractIncludes('\\input{sections/method}')
    expect(ref.raw).toBe('sections/method')
    expect(ref.path).toBe('sections/method.tex')
  })

  it('skips a commented-out include', () => {
    const tex = '% \\input{old-draft}\n\\input{current}'
    expect(extractIncludes(tex).map((r) => r.path)).toEqual(['current.tex'])
  })

  it('does not mistake an escaped percent for a comment', () => {
    const tex = 'Coverage was 90\\% \\input{results}'
    expect(extractIncludes(tex).map((r) => r.path)).toEqual(['results.tex'])
  })

  it('drops a reference that would escape the paper folder', () => {
    expect(extractIncludes('\\input{../../elsewhere}')).toEqual([])
  })

  it('is not confused by \\includegraphics', () => {
    // It starts with `include` but names an image, not a source file.
    expect(extractIncludes('\\includegraphics{figures/plot}')).toEqual([])
  })

  it('returns nothing for a single-file paper', () => {
    expect(extractIncludes('\\section{One}\nAll of it right here.')).toEqual([])
  })
})
