import { describe, it, expect } from 'vitest'
import {
  addTabularColumn,
  addTabularRow,
  growColumnSpec,
  removeTabularColumn,
  removeTabularRow,
  setTabularColumnSpec,
  setTabularShape,
  shrinkColumnSpec,
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

describe('setting the shape', () => {
  it('grows to the shape asked for, with the new cells empty', () => {
    const next = setTabularShape(TABLE, { rows: 5, columns: 4 })
    expect(tabularShape(next)).toEqual({ rows: 5, columns: 4 })
    expect(next).toContain('{@{}lccc@{}}')
    // The rows that were there keep what was in them.
    expect(next).toContain('SGD & 4.81 & 0.92 &')
  })

  it('shrinks, and takes the column out of the spec with it', () => {
    const next = setTabularShape(TABLE, { rows: 2, columns: 2 })
    expect(tabularShape(next)).toEqual({ rows: 2, columns: 2 })
    expect(next).toContain('{@{}lc@{}}')
    expect(next).toContain('Method & Acc \\\\')
    expect(next).not.toContain('CMD')
  })

  it('leaves the rules where they are when a row goes', () => {
    // The `\midrule` divides the header from the body. Deleting the body's
    // last row is not a reason to lose it — adding a row back wouldn't
    // bring it with it.
    const next = setTabularShape(TABLE, { rows: 1 })
    expect(next).toContain('\\toprule')
    expect(next).toContain('\\midrule')
    expect(next).toContain('\\bottomrule')
    expect(tabularShape(next).rows).toBe(1)
  })

  it('keeps at least one row and one column', () => {
    const next = setTabularShape(TABLE, { rows: 0, columns: 0 })
    expect(tabularShape(next)).toEqual({ rows: 1, columns: 1 })
  })

  it('changes nothing when asked for the shape it already has', () => {
    expect(setTabularShape(TABLE, { rows: 3, columns: 3 })).toBe(TABLE)
  })

  it('drops the last column of every row, not the last row\'s', () => {
    const next = removeTabularColumn(TABLE)
    expect(next).toContain('Method & Acc \\\\')
    expect(next).toContain('SGD & 4.81 \\\\')
    expect(next).toContain('CMD & 0.84 \\\\')
  })

  it('refuses to remove the last row or column there is', () => {
    const one = '\\begin{tabular}{l}\n  a \\\\\n\\end{tabular}'
    expect(removeTabularRow(one)).toBe(one)
    expect(removeTabularColumn(one)).toBe(one)
  })

  it('takes a column out of the spec from where the column was', () => {
    expect(shrinkColumnSpec('@{}lrr@{}')).toBe('@{}lr@{}')
    expect(shrinkColumnSpec('|c|c|')).toBe('|c||')
    expect(shrinkColumnSpec('lp{3cm}')).toBe('l')
    // Never down to nothing: a spec with no columns renders as no table.
    expect(shrinkColumnSpec('l')).toBe('l')
  })

  it('leaves a source that is not a table alone', () => {
    const other = '\\begin{align}a &= b\\end{align}'
    expect(setTabularShape(other, { rows: 4, columns: 4 })).toBe(other)
  })
})
