import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { buildDiagnosticsFor, errorBelongsTo } from '@renderer/editor/source/build-diagnostics'
import type { BuildError } from '@shared/types'

// The compiler's errors, placed on the lines they name. The source view's
// gutter used to carry only the two hand-written syntax checks while these
// — already parsed, already carrying file and line — went nowhere.

const DOC = ['line one', 'line two', 'line three', 'line four'].join('\n')

function state(doc = DOC): EditorState {
  return EditorState.create({ doc })
}

function error(patch: Partial<BuildError>): BuildError {
  return { message: 'Undefined control sequence', severity: 'error', ...patch }
}

describe('errorBelongsTo', () => {
  it('matches the plain name TeX writes', () => {
    expect(errorBelongsTo('./main.tex', 'main.tex')).toBe(true)
    expect(errorBelongsTo('main.tex', 'main.tex')).toBe(true)
  })

  it('matches an absolute path by its tail', () => {
    expect(errorBelongsTo('/home/u/papers/x/sections/method.tex', 'sections/method.tex')).toBe(true)
  })

  it('matches when the log omits the extension', () => {
    expect(errorBelongsTo('./sections/method', 'sections/method.tex')).toBe(true)
  })

  it('tolerates Windows separators', () => {
    expect(errorBelongsTo('.\\sections\\method.tex', 'sections/method.tex')).toBe(true)
  })

  it('rejects a different file', () => {
    expect(errorBelongsTo('./other.tex', 'main.tex')).toBe(false)
    // `notmain.tex` ends with `main.tex` as a string but is not the file.
    expect(errorBelongsTo('./notmain.tex', 'main.tex')).toBe(false)
  })

  it('rejects an error with no file at all', () => {
    expect(errorBelongsTo(undefined, 'main.tex')).toBe(false)
  })
})

describe('buildDiagnosticsFor', () => {
  it('anchors an error on the line the log names', () => {
    const diagnostics = buildDiagnosticsFor(state(), {
      activeFile: 'main.tex',
      errors: [error({ file: './main.tex', line: 2 })]
    })
    expect(diagnostics).toHaveLength(1)
    // Line 2 of the doc, 1-based in the log.
    expect(diagnostics[0].from).toBe(9)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].message).toBe('Undefined control sequence')
  })

  it('carries the warning severity through', () => {
    const diagnostics = buildDiagnosticsFor(state(), {
      activeFile: 'main.tex',
      errors: [error({ file: 'main.tex', line: 1, severity: 'warning' })]
    })
    expect(diagnostics[0].severity).toBe('warning')
  })

  it('drops errors belonging to another file', () => {
    const diagnostics = buildDiagnosticsFor(state(), {
      activeFile: 'main.tex',
      errors: [error({ file: './sections/method.tex', line: 2 })]
    })
    expect(diagnostics).toEqual([])
  })

  it('leaves an error with no line to the panel', () => {
    // "Is TeX Live installed?" belongs in the problem list, not on a line.
    const diagnostics = buildDiagnosticsFor(state(), {
      activeFile: 'main.tex',
      errors: [error({ message: 'Failed to spawn latexmk' })]
    })
    expect(diagnostics).toEqual([])
  })

  it('clamps a line past the end of the file rather than dropping it', () => {
    // The user has kept typing since the build; the squiggle being one line
    // out beats the error disappearing.
    const diagnostics = buildDiagnosticsFor(state(), {
      activeFile: 'main.tex',
      errors: [error({ file: 'main.tex', line: 900 })]
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].to).toBe(DOC.length)
  })

  it('returns nothing when there is nothing to report', () => {
    expect(buildDiagnosticsFor(state(), { activeFile: 'main.tex', errors: [] })).toEqual([])
  })
})
