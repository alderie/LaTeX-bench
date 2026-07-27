import { describe, it, expect } from 'vitest'
import { parseLatexLog } from '../src/main/latex/log-parser'

// The log parser behind the problem list. A build that fails without
// producing a parseable error is the case the panel used to render as
// "Build failed" over an empty list — see the fallback in compiler.ts.

describe('parseLatexLog', () => {
  it('reads the file and line from a -file-line-error message', () => {
    const errors = parseLatexLog('./main.tex:42: Undefined control sequence.')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      file: './main.tex',
      line: 42,
      severity: 'error'
    })
  })

  it('reads a bare TeX error with no location', () => {
    const errors = parseLatexLog('! Missing $ inserted.')
    expect(errors[0].severity).toBe('error')
    expect(errors[0].line).toBeUndefined()
  })

  it('reads a LaTeX warning', () => {
    const errors = parseLatexLog("LaTeX Warning: Citation `tsallis1988' undefined.")
    expect(errors[0].severity).toBe('warning')
    expect(errors[0].message).toContain('tsallis1988')
  })

  it('de-dupes a warning pdflatex repeats', () => {
    const log = [
      "LaTeX Warning: Reference `fig:1' undefined.",
      '',
      "LaTeX Warning: Reference `fig:1' undefined."
    ].join('\n')
    expect(parseLatexLog(log)).toHaveLength(1)
  })

  it('finds nothing in a clean log', () => {
    expect(parseLatexLog('This is pdfTeX\nOutput written on main.pdf (2 pages).')).toEqual([])
  })

  it('finds nothing in an empty log — the case the fallback covers', () => {
    // A binary that isn't installed leaves no log at all. There is nothing
    // here to report, which is why the compiler synthesises an error rather
    // than handing the panel an empty list for a failed build.
    expect(parseLatexLog('')).toEqual([])
    expect(parseLatexLog('\n')).toEqual([])
  })
})
