import { describe, it, expect } from 'vitest'
import {
  addColumn,
  addRow,
  cellSpans,
  errorOffset,
  gridCells,
  gridSpans,
  nextCell,
  parseMathShell,
  presentBody,
  rewriteGrid,
  serializeMathShell,
  shellChoice,
  splitCells,
  splitRows,
  switchEnvironment,
  tidyErrorMessage,
  withLabelText,
  writeCell
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

describe('the grids in a formula', () => {
  const shellFor = (body: string): ReturnType<typeof parseMathShell> =>
    parseMathShell(`\\[\n${body}\n\\]`)

  it('finds a matrix buried in a larger expression', () => {
    // The old cells view refused this — it only understood a body that was
    // nothing but a matrix — which ruled out most matrices anyone writes.
    const body = 'A = \\begin{pmatrix} a & b \\end{pmatrix}'
    const spans = gridSpans(shellFor(body), body)
    expect(spans).toHaveLength(1)
    expect(spans[0].env).toBe('pmatrix')
    expect(body.slice(spans[0].from, spans[0].to)).toBe(' a & b ')
  })

  it('finds every matrix, in the order they are drawn', () => {
    const body = 'H = \\begin{pmatrix}2 & 1\\end{pmatrix}, \\quad H^{-1} = \\begin{pmatrix}3\\end{pmatrix}'
    const spans = gridSpans(shellFor(body), body)
    expect(spans.map((span) => body.slice(span.from, span.to))).toEqual(['2 & 1', '3'])
  })

  it('takes the whole body when the formula is itself a grid, outermost first', () => {
    const body = 'a &= \\begin{cases} p \\\\ q \\end{cases}'
    const shell = parseMathShell(`\\begin{align}\n${body}\n\\end{align}`)
    const spans = gridSpans(shell, body)
    expect(spans[0]).toEqual({ from: 0, to: body.length, env: '' })
    expect(spans[1].env).toBe('cases')
  })

  it('keeps an environment argument out of the cells', () => {
    const body = '\\begin{array}{cc} a & b \\end{array}'
    const spans = gridSpans(shellFor(body), body)
    expect(body.slice(spans[0].from, spans[0].to)).toBe(' a & b ')
  })

  it('counts \\substack as a grid, since that is what gets drawn', () => {
    // Not for its own sake: a grid that isn't accounted for would make every
    // later matrix in the formula trace back to the wrong source.
    const body = '\\sum_{\\substack{i < j \\\\ k}} x'
    expect(gridSpans(shellFor(body), body).map((span) => span.env)).toEqual(['substack'])
  })
})

describe('a grid as offsets', () => {
  const shellFor = (body: string): ReturnType<typeof parseMathShell> =>
    parseMathShell(`\\[\n${body}\n\\]`)

  const cellsOf = (body: string): Array<[number, number, string]> => {
    const span = gridSpans(shellFor(body), body)[0]
    return gridCells(body, span).map((cell) => [cell.row, cell.column, body.slice(cell.from, cell.to)])
  }

  it('gives each cell the span of its text, without the padding', () => {
    expect(cellsOf('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toEqual([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, 'c'],
      [1, 1, 'd']
    ])
  })

  it('drops the empty row a trailing row break leaves behind', () => {
    // KaTeX doesn't draw one either, and a cell with nothing drawn for it is
    // a cell that can't be clicked.
    expect(cellsOf('\\begin{pmatrix} a & b \\\\ \\end{pmatrix}')).toEqual([
      [0, 0, 'a'],
      [0, 1, 'b']
    ])
  })

  it('keeps a blank row that carries its own separators', () => {
    // What adding a row makes. KaTeX draws it — two empty cells to click —
    // and dropping it as punctuation left the new row unreachable.
    expect(cellsOf('\\begin{pmatrix} a & b \\\\ & \\end{pmatrix}')).toEqual([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, ''],
      [1, 1, '']
    ])
  })

  it('leaves a short row short rather than padding it', () => {
    expect(cellsOf('\\begin{pmatrix} a & b \\\\ c \\end{pmatrix}')).toEqual([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, 'c']
    ])
  })

  it('writes a cell back without touching anything else', () => {
    const body = '\\begin{pmatrix} a & b \\end{pmatrix}'
    const span = gridSpans(shellFor(body), body)[0]
    const cell = gridCells(body, span)[1]
    expect(writeCell(body, cell.from, cell.to, 'x^2').body).toBe(
      '\\begin{pmatrix} a & x^2 \\end{pmatrix}'
    )
  })

  it('keeps a space between a cell it fills and the separator', () => {
    // `a &x& b` is valid and unreadable; the source is still something the
    // author opens in another editor.
    const body = 'a & & b'
    const span = gridSpans(parseMathShell(`\\begin{align}\n${body}\n\\end{align}`), body)[0]
    const empty = gridCells(body, span)[1]
    const result = writeCell(body, empty.from, empty.to, 'z')
    expect(result.body).toBe('a & z & b')
  })

  it('reports where what it wrote ends, so the next keystroke lands on it', () => {
    // A cell is written on every keystroke; without this the second one
    // would land beside the first instead of replacing it.
    const body = 'a & b'
    const span = gridSpans(parseMathShell(`\\begin{align}\n${body}\n\\end{align}`), body)[0]
    const cell = gridCells(body, span)[1]
    const first = writeCell(body, cell.from, cell.to, 'xy')
    const second = writeCell(first.body, cell.from, first.to, 'xyz')
    expect(second.body).toBe('a & xyz')
  })

  it('rewrites one grid and leaves the formula around it alone', () => {
    const body = 'H = \\begin{pmatrix}2 & 1\\end{pmatrix} + \\begin{pmatrix}3 & 4\\end{pmatrix}'
    const span = gridSpans(shellFor(body), body)[1]
    expect(rewriteGrid(body, span, addColumn)).toBe(
      'H = \\begin{pmatrix}2 & 1\\end{pmatrix} + \\begin{pmatrix}3 & 4 & \\end{pmatrix}'
    )
  })
})
