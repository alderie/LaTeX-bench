import { describe, it, expect } from 'vitest'
import {
  addTabularColumn,
  addTabularRow,
  growColumnSpec,
  setTabularColumnSpec,
  tabularColumnCount,
  tabularShape
} from '@renderer/editor/wysiwyg/renderers/tabular-edit'

// A table is stored as raw LaTeX so that `\multicolumn`, booktabs rules and
// `@{}` material survive a round-trip. That makes every structural edit a
// splice rather than a re-print — and the thing to test is that the splice
// lands in the right place and leaves everything else alone.

const TABLE = `\\begin{tabular}{@{}lcc@{}}
  \\toprule
  Method & Acc & Time \\\\
  \\midrule
  SGD & 4.81 & 0.92 \\\\
  CMD & 0.84 & 0.11 \\\\
  \\bottomrule
\\end{tabular}`

describe('reading a table', () => {
  it('counts columns from the rows, not the spec', () => {
    // The spec is routinely wrong or missing in files in the wild; the rows
    // are what the reader actually sees.
    expect(tabularColumnCount(TABLE)).toBe(3)
    expect(tabularShape(TABLE)).toEqual({ rows: 3, columns: 3 })
  })

  it('ignores rule-only segments when counting rows', () => {
    expect(tabularShape(TABLE).rows).toBe(3)
  })
})

describe('adding a row', () => {
  it('puts it above the closing rule', () => {
    // Below `\bottomrule` the row renders outside the table's own frame,
    // which reads as a bug in the editor rather than as an empty row.
    const next = addTabularRow(TABLE)
    const lines = next.split('\n')
    const bottom = lines.findIndex((line) => line.includes('\\bottomrule'))
    expect(lines[bottom - 1].trim()).toBe('&  & \\\\')
  })

  it('gives the new row as many cells as the widest one', () => {
    const before = tabularShape(TABLE)
    const after = tabularShape(addTabularRow(TABLE))
    expect(after.rows).toBe(before.rows + 1)
    expect(after.columns).toBe(before.columns)
  })

  it('appends to a table that has no closing rule', () => {
    const plain = '\\begin{tabular}{ll}\n  a & b \\\\\n\\end{tabular}'
    expect(tabularShape(addTabularRow(plain)).rows).toBe(2)
  })

  it('leaves everything outside the splice untouched', () => {
    const next = addTabularRow(TABLE)
    expect(next).toContain('\\toprule')
    expect(next).toContain('SGD & 4.81 & 0.92')
    expect(next).toContain('\\begin{tabular}{@{}lcc@{}}')
  })
})

describe('adding a column', () => {
  it('extends every content row and skips the rules', () => {
    const next = addTabularColumn(TABLE)
    expect(tabularShape(next)).toEqual({ rows: 3, columns: 4 })
    // A rule line gaining an `&` would make it a row of empty cells.
    expect(next).toContain('\\midrule\n')
    expect(next).not.toMatch(/\\midrule[^\n]*&/)
  })

  it('grows the column spec inside its @{} material', () => {
    // `@{}` is inter-column padding, not a column: a letter after it prints
    // the new column outside the table's margin.
    expect(addTabularColumn(TABLE)).toContain('{@{}lccc@{}}')
  })

  it('repeats the last real column type', () => {
    expect(growColumnSpec('@{}lrr@{}')).toBe('@{}lrrr@{}')
    expect(growColumnSpec('|c|c|')).toBe('|c|cc|')
    expect(growColumnSpec('@{}')).toBe('@{}l')
  })
})

describe('the column spec', () => {
  it('can be replaced without touching the body', () => {
    const next = setTabularColumnSpec(TABLE, 'lrr')
    expect(next).toContain('\\begin{tabular}{lrr}')
    expect(next).toContain('CMD & 0.84 & 0.11')
  })

  it('leaves a source that is not a table alone', () => {
    const other = '\\begin{align}a &= b\\end{align}'
    expect(addTabularRow(other)).toBe(other)
    expect(addTabularColumn(other)).toBe(other)
  })
})
