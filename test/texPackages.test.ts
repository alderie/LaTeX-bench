import { describe, it, expect } from 'vitest'
import {
  EXTRA_PACKAGES,
  missingPackagesFromLog,
  packageForFile
} from '../src/main/latex/tex-packages'

// Turning "Emergency stop" back into something actionable. The logs below are
// copied from real pdflatex runs against the app's managed installation.

const MATHTOOLS_LOG = `
(c:/…/texmf-dist/tex/latex/amscls/amsthm.sty
Package: amsthm 2020/05/29 v2.20.6
)

! LaTeX Error: File \`mathtools.sty' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)

Enter file name:
./main.tex:20: Emergency stop.
<read *>

l.20 ^^M

*** (cannot \\read from terminal in nonstop modes)
./main.tex:20:  ==> Fatal error occurred, no output PDF file produced!
`

describe('missingPackagesFromLog', () => {
  it('names the package behind a fatal "file not found"', () => {
    expect(missingPackagesFromLog(MATHTOOLS_LOG)).toEqual([
      { file: 'mathtools.sty', name: 'mathtools' }
    ])
  })

  it('finds nothing in a log that compiled', () => {
    expect(missingPackagesFromLog('Output written on .build/main.pdf (1 page).')).toEqual([])
  })

  it('leaves a missing .tex alone — that is the author’s own file', () => {
    expect(missingPackagesFromLog("! LaTeX Error: File `sections/method.tex' not found.")).toEqual(
      []
    )
  })

  it('survives the 79-column wrap TeX puts through the middle of messages', () => {
    // pdflatex hard-wraps its log and will break inside the quoted name.
    const wrapped = "! LaTeX Error: File `pgfplots.\nsty' not found."
    expect(missingPackagesFromLog(wrapped)).toEqual([
      { file: 'pgfplots.sty', name: 'pgfplots' }
    ])
  })

  it('reports each package once, however often the log repeats it', () => {
    const twice = MATHTOOLS_LOG + MATHTOOLS_LOG
    expect(missingPackagesFromLog(twice)).toHaveLength(1)
  })

  it('collects several when a run reported several', () => {
    const log = "File `tikz.sty' not found.\nFile `siunitx.sty' not found."
    expect(missingPackagesFromLog(log).map((m) => m.name)).toEqual(['pgf', 'siunitx'])
  })
})

describe('packageForFile', () => {
  it('takes the filename when the package is named after it', () => {
    expect(packageForFile('mathtools.sty')).toBe('mathtools')
    expect(packageForFile('acmart.cls')).toBe('acmart')
  })

  it('knows the ones where the filename would send tlmgr somewhere wrong', () => {
    // Each of these fails the whole install step if asked for by filename.
    expect(packageForFile('tikz.sty')).toBe('pgf')
    expect(packageForFile('algpseudocode.sty')).toBe('algorithmicx')
    expect(packageForFile('algorithm.sty')).toBe('algorithms')
    expect(packageForFile('subcaption.sty')).toBe('caption')
    expect(packageForFile('lmodern.sty')).toBe('lm')
  })

  it('routes any TikZ library to pgf rather than enumerating hundreds', () => {
    expect(packageForFile('tikzlibraryarrows.meta.code.tex')).toBe('pgf')
    expect(packageForFile('pgflibraryshapes.code.tex')).toBe('pgf')
  })

  it('gives up rather than handing tlmgr a name that cannot be one', () => {
    expect(packageForFile('../etc/passwd.sty')).toBeNull()
    expect(packageForFile('.sty')).toBeNull()
  })
})

describe('EXTRA_PACKAGES', () => {
  it('carries the two whose absence broke a real paper', () => {
    // A document with `\\usepackage{mathtools}` and a TikZ figure is ordinary,
    // and both used to fail on a fresh install.
    expect(EXTRA_PACKAGES).toContain('mathtools')
    expect(EXTRA_PACKAGES).toContain('pgf')
  })

  it('names no package twice — tlmgr is given this list verbatim', () => {
    expect(new Set(EXTRA_PACKAGES).size).toBe(EXTRA_PACKAGES.length)
  })
})
