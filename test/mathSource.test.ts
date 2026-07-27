import { describe, it, expect } from 'vitest'
import {
  addColumn,
  addRow,
  cellSpans,
  errorOffset,
  findGrids,
  gridCells,
  nextCell,
  parseMathShell,
  presentBody,
  removeColumn,
  removeRow,
  serializeMathShell,
  setCell,
  shellChoice,
  splitCells,
  splitRows,
  switchEnvironment,
  tidyErrorMessage,
  withLabelText
} from '@renderer/editor/wysiwyg/math-source'

// The formula editor shows the author their maths and nothing else — no
// `\begin{equation}` to keep in sync, no indentation to match by hand. That
// only holds if taking the wrapper off and putting it back is exact.

const EQUATION = `\\begin{equation}
  \\label{eq:bregman}
  D_\\psi(x, y) \\coloneqq \\psi(x) - \\psi(y)
\\end{equation}`

describe('splitting a formula from its wrapper', () => {
  it('separates environment, label, and maths', () => {
    const shell = parseMathShell(EQUATION)
    expect(shell.kind).toBe('env')
    expect(shell.env).toBe('equation')
    expect(shell.starred).toBe(false)
    expect(shell.label).toBe('eq:bregman')
    expect(presentBody(shell)).toBe('D_\\psi(x, y) \\coloneqq \\psi(x) - \\psi(y)')
  })

  it('puts an untouched formula back byte for byte', () => {
    // Anything less shows up as a spurious diff in the saved .tex every
    // time someone opens a formula and closes it again.
    const shell = parseMathShell(EQUATION)
    expect(serializeMathShell(shell)).toBe(EQUATION)
  })

  it('handles \\[…\\] displays, which are delimiters and not an environment', () => {
    const source = '\\[\n  x = y\n\\]'
    const shell = parseMathShell(source)
    expect(shell.kind).toBe('bracket')
    expect(presentBody(shell)).toBe('x = y')
    expect(serializeMathShell(shell)).toBe(source)
  })

  it('preserves an environment argument like array{cc}', () => {
    const source = '\\begin{array}{cc}\n  a & b\n\\end{array}'
    expect(serializeMathShell(parseMathShell(source))).toBe(source)
  })

  it('does not mistake a braced first line for an environment argument', () => {
    const source = '\\begin{equation}\n{x + y}\n\\end{equation}'
    expect(presentBody(parseMathShell(source))).toBe('{x + y}')
  })

  it('leaves per-row labels inside a multi-row align', () => {
    // In an `align` which row a label sits on decides what \ref points at,
    // so lifting it into a single field would silently move the target.
    const source =
      '\\begin{align}\n  a &= b \\label{eq:one} \\\\\n  c &= d \\label{eq:two}\n\\end{align}'
    const shell = parseMathShell(source)
    expect(shell.label).toBeNull()
    expect(presentBody(shell)).toContain('\\label{eq:one}')
    expect(serializeMathShell(shell)).toBe(source)
  })

  it('keeps a trailing label at the end where the author wrote it', () => {
    const source = '\\begin{equation}\n  a = b \\label{eq:x}\n\\end{equation}'
    const shell = parseMathShell(source)
    expect(shell.label).toBe('eq:x')
    expect(shell.labelPlacement).toBe('trailing')
    expect(serializeMathShell(shell)).toBe(source)
  })

  it('offers no environment switch for a wrapper it does not understand', () => {
    const shell = parseMathShell('\\begin{subequations}\n  x\n\\end{subequations}')
    expect(shellChoice(shell)).toBeNull()
  })

  it('writes a new label into the source', () => {
    const shell = withLabelText(parseMathShell(EQUATION), 'eq:renamed')
    expect(serializeMathShell(shell)).toContain('\\label{eq:renamed}')
    expect(serializeMathShell(shell)).not.toContain('eq:bregman')
  })
})

describe('switching environment', () => {
  it('unnumbers an equation without touching the maths', () => {
    const shell = parseMathShell(EQUATION)
    const result = switchEnvironment(shell, 'equation*', presentBody(shell))
    const source = serializeMathShell(result.shell, result.body)
    expect(source.startsWith('\\begin{equation*}')).toBe(true)
    expect(source.trimEnd().endsWith('\\end{equation*}')).toBe(true)
    expect(source).toContain('D_\\psi(x, y)')
  })

  it('gives align something to align on', () => {
    // Moving to `align` without an `&` renders as one centred line, which
    // looks like the switch did nothing.
    const shell = parseMathShell(EQUATION)
    const result = switchEnvironment(shell, 'align', presentBody(shell))
    expect(result.body).toContain('&\\coloneqq')
  })

  it('does not add a second alignment point to a body that has one', () => {
    const shell = parseMathShell('\\begin{align}\n  a &= b\n\\end{align}')
    const result = switchEnvironment(shell, 'gather', presentBody(shell))
    expect(result.body).toBe('a &= b')
  })

  it('folds rows into one line when leaving a grid', () => {
    // `&` is a parse error in `equation`, so carrying the rows across
    // unchanged produces a formula that renders red.
    const shell = parseMathShell('\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}')
    const result = switchEnvironment(shell, 'equation', presentBody(shell))
    expect(result.body).toBe('a = b \\quad c = d')
  })
})

describe('grid structure', () => {
  it('splits rows on top-level \\\\ only', () => {
    const body = 'a \\\\ \\begin{cases} p \\\\ q \\end{cases} \\\\ b'
    expect(splitRows(body)).toHaveLength(3)
  })

  it('ignores a row break inside braces', () => {
    expect(splitRows('\\text{one \\\\ two}')).toHaveLength(1)
  })

  it('splits cells on top-level & only', () => {
    expect(splitCells('a & b')).toHaveLength(2)
    expect(splitCells('\\text{a & b}')).toHaveLength(1)
    expect(splitCells('a \\& b')).toHaveLength(1)
  })

  it('keeps an optional row-break spacing argument out of the next row', () => {
    const rows = splitRows('a \\\\[6pt] b')
    expect(rows).toHaveLength(2)
    expect(rows[1].trim()).toBe('b')
  })

  it('adds a row with the same number of columns', () => {
    const next = addRow('a & b \\\\\nc & d')
    expect(splitRows(next)).toHaveLength(3)
    expect(splitCells(splitRows(next)[2])).toHaveLength(2)
  })

  it('adds a column to every row, keeping the grid rectangular', () => {
    const next = addColumn('a & b \\\\\nc & d')
    for (const row of splitRows(next)) expect(splitCells(row)).toHaveLength(3)
  })

  it('walks cells in reading order', () => {
    const spans = cellSpans('a & b \\\\\nc & d')
    expect(spans.map((s) => [s.row, s.column])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1]
    ])
  })

  it('moves to the next cell and reports the end of the grid', () => {
    const body = 'a & b'
    expect(nextCell(body, 0, 1)?.column).toBe(1)
    // Nothing after the last cell — the caller grows the grid instead.
    expect(nextCell(body, body.length, 1)).toBeNull()
    expect(nextCell(body, 0, -1)).toBeNull()
  })
})

describe('KaTeX error messages', () => {
  const message =
    "KaTeX parse error: Undefined control sequence: \\foo at position 7: x = \\̲f̲o̲o̲{y}"

  it('finds the offset so the caret can be put on the offending token', () => {
    expect(errorOffset(message)).toBe(6)
  })

  it('drops the boilerplate and the source echo', () => {
    expect(tidyErrorMessage(message)).toBe('Undefined control sequence: \\foo')
  })

  it('survives a message with no position at all', () => {
    expect(errorOffset('KaTeX parse error: something went wrong')).toBeNull()
  })
})

describe('finding the grids in a formula', () => {
  const shellOf = (latex: string): ReturnType<typeof parseMathShell> => parseMathShell(latex)

  it('finds a matrix nested inside an equation', () => {
    const shell = shellOf('\\begin{equation}\nA = \\begin{pmatrix}1 & 2\\end{pmatrix}\n\\end{equation}')
    const grids = findGrids(shell, presentBody(shell))
    expect(grids).toHaveLength(1)
    expect(grids[0].env).toBe('pmatrix')
    expect(presentBody(shell).slice(grids[0].from, grids[0].to)).toBe('1 & 2')
  })

  it('finds both matrices when a line has two of them', () => {
    // The case that made the old toolbar buttons useless: one equation,
    // two independent grids, and no way to say which one to grow.
    const body = String.raw`H = \begin{pmatrix}2 & 1\end{pmatrix}, H^{-1} = \begin{bmatrix}0 & 1\end{bmatrix}`
    const grids = findGrids(shellOf(`\\[\n${body}\n\\]`), body)
    expect(grids.map((g) => g.env)).toEqual(['pmatrix', 'bmatrix'])
  })

  it('reports only the outer grid when one is nested in another', () => {
    const body = String.raw`\begin{pmatrix}\begin{smallmatrix}1\end{smallmatrix} & 2\end{pmatrix}`
    expect(findGrids(shellOf(`\\[\n${body}\n\\]`), body).map((g) => g.env)).toEqual(['pmatrix'])
  })

  it('skips the environment’s own arguments', () => {
    const body = String.raw`\begin{array}{cc}1 & 2\end{array}`
    const [grid] = findGrids(shellOf(`\\[\n${body}\n\\]`), body)
    expect(body.slice(grid.from, grid.to)).toBe('1 & 2')
  })

  it('falls back to the environment itself when nothing is nested', () => {
    const shell = shellOf('\\begin{align}\na &= b\n\\end{align}')
    expect(findGrids(shell, presentBody(shell))).toEqual([
      { env: 'align', from: 0, to: 'a &= b'.length }
    ])
  })

  it('finds nothing in a formula that has no grid', () => {
    const shell = shellOf('\\begin{equation}\nx = y\n\\end{equation}')
    expect(findGrids(shell, presentBody(shell))).toEqual([])
  })
})

describe('editing a grid cell by cell', () => {
  const BODY = '1 & 2 \\\\ 3 & 4'

  it('lays the body out as a rectangle of trimmed cells', () => {
    expect(gridCells(BODY)).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('replaces one cell and keeps the padding around it', () => {
    // Matrices are commonly padded into alignment by hand; changing one
    // entry shouldn't collapse the column.
    expect(setCell('1  &  2', 0, 1, '10')).toBe('1  &  10')
  })

  it('leaves the rest of the body alone', () => {
    expect(setCell(BODY, 1, 0, 'x')).toBe('1 & 2 \\\\ x & 4')
  })

  it('ignores a cell that isn’t there', () => {
    expect(setCell(BODY, 5, 5, 'x')).toBe(BODY)
  })

  it('removes a middle row along with one separator', () => {
    expect(removeRow('a \\\\ b \\\\ c', 1)).toBe('a \\\\ c')
  })

  it('removes the last row without leaving a trailing break', () => {
    expect(removeRow('a \\\\ b', 1)).toBe('a ')
  })

  it('refuses to remove the only row', () => {
    expect(removeRow('a & b', 0)).toBe('a & b')
  })

  it('removes a column from every row', () => {
    expect(removeColumn(BODY, 0)).toBe(' 2 \\\\ 4')
  })

  it('refuses to remove the only column', () => {
    expect(removeColumn('a \\\\ b', 0)).toBe('a \\\\ b')
  })

  it('keeps rows on their own lines when a column is added', () => {
    expect(addColumn('a & b \\\\\nc & d')).toBe('a & b & \\\\\nc & d & ')
  })
})

describe('cells that span lines', () => {
  it('shows a multi-line cell on one line', () => {
    // A one-line field renders a newline as nothing, so the source
    // `\label{eq:x}\nx_{t+1}` would read as one run-on token — and be
    // written back that way the first time the cell was touched.
    const body = '\\label{eq:x}\n  x_{t+1} &= y'
    expect(gridCells(body)[0][0]).toBe('\\label{eq:x} x_{t+1}')
  })

  it('leaves the rest of the source alone when such a cell is edited', () => {
    const body = 'a\n  b &= c'
    expect(setCell(body, 0, 1, '= d')).toBe('a\n  b &= d')
  })
})
