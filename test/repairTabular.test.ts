import { describe, it, expect } from 'vitest'
import {
  countColumns,
  defaultSpec,
  repairMissingColumnSpec
} from '@renderer/editor/wysiwyg/repair-tabular'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'

// `\begin{tabular}` with no column spec is a fatal error, not a cosmetic
// one: LaTeX reads the following token as the spec, gives up with "Use of
// \@array doesn't match its definition", and the aborted run leaves the
// .aux file incomplete — so every \cite and \ref reports undefined too.

// Verbatim from a document damaged by an earlier build, down to the row of
// empty cells left by an "add row" on the already-broken table.
const DAMAGED =
  '\\begin{tabular}\\toprule & \\multicolumn{3}{c}{Stable index $\\alpha$} \\\\ ' +
  '\\cmidrule(lr){2-4} Method & $1.2$ & $1.5$ & $1.8$ \\\\ \\midrule ' +
  'SGD & $4.81 \\pm 0.92$ & $1.73 \\pm 0.31$ & $0.42 \\pm 0.06$ \\\\ ' +
  '\\textbf{CMD} & $\\mathbf{0.84}$ & $\\mathbf{0.46}$ & $\\mathbf{0.21}$ \\\\\n' +
  '  &  &  & \\\\ \\bottomrule\\end{tabular}'

describe('repairMissingColumnSpec', () => {
  it('restores a spec on the real damaged table', () => {
    const fixed = repairMissingColumnSpec(DAMAGED)
    expect(fixed.startsWith('\\begin{tabular}{lccc}')).toBe(true)
  })

  it('changes nothing else about the table', () => {
    const fixed = repairMissingColumnSpec(DAMAGED)
    expect(fixed.replace('{lccc}', '')).toBe(DAMAGED)
  })

  it('leaves an intact table completely alone', () => {
    const good = '\\begin{tabular}{@{}lccc@{}}\nA & B & C & D \\\\\n\\end{tabular}'
    expect(repairMissingColumnSpec(good)).toBe(good)
  })

  it('leaves a table with a position argument alone', () => {
    const good = '\\begin{tabular}[t]{lcc}\nA & B & C \\\\\n\\end{tabular}'
    expect(repairMissingColumnSpec(good)).toBe(good)
  })

  it('does not touch tabularx or tabular*, whose first argument is a width', () => {
    // Guessing there would move a width into the column spec and break a
    // table that currently compiles.
    const x = '\\begin{tabularx}{\\textwidth}{lX}\nA & B \\\\\n\\end{tabularx}'
    expect(repairMissingColumnSpec(x)).toBe(x)
    const star = '\\begin{tabular*}{\\textwidth}{ll}\nA & B \\\\\n\\end{tabular*}'
    expect(repairMissingColumnSpec(star)).toBe(star)
  })

  it('repairs an array and a longtable too', () => {
    expect(repairMissingColumnSpec('\\begin{array}a & b \\\\\\end{array}')).toContain(
      '\\begin{array}{lc}'
    )
    expect(repairMissingColumnSpec('\\begin{longtable}a & b \\\\\\end{longtable}')).toContain(
      '\\begin{longtable}{lc}'
    )
  })

  it('repairs each damaged table in a document independently', () => {
    const two =
      'x \\begin{tabular}a & b \\\\\\end{tabular} y ' +
      '\\begin{tabular}a & b & c \\\\\\end{tabular} z'
    const fixed = repairMissingColumnSpec(two)
    expect(fixed).toContain('\\begin{tabular}{lc}')
    expect(fixed).toContain('\\begin{tabular}{lcc}')
  })

  it('handles a nested tabular inside a damaged one', () => {
    const nested = '\\begin{tabular}a & \\begin{tabular}{c}z\\\\\\end{tabular} \\\\\\end{tabular}'
    const fixed = repairMissingColumnSpec(nested)
    expect(fixed.startsWith('\\begin{tabular}{lc}')).toBe(true)
    // The inner one already had its spec and keeps it.
    expect(fixed).toContain('\\begin{tabular}{c}z')
  })

  it('leaves a document with no tables untouched', () => {
    const plain = '\\section{One}\nProse with $a & b$ nothing else.'
    expect(repairMissingColumnSpec(plain)).toBe(plain)
  })

  it('survives an unterminated environment rather than throwing', () => {
    const broken = '\\begin{tabular}a & b \\\\'
    expect(repairMissingColumnSpec(broken)).toBe(broken)
  })
})

describe('countColumns', () => {
  it('takes the widest row', () => {
    expect(countColumns('a & b \\\\ c & d & e \\\\')).toBe(3)
  })

  it('counts a \\multicolumn span as the columns it covers', () => {
    // The header of the damaged table is `& \multicolumn{3}{c}{…}`: two
    // cells by `&`, but four columns wide.
    expect(countColumns('& \\multicolumn{3}{c}{Stable index} \\\\')).toBe(4)
  })

  it('ignores rule-only segments', () => {
    expect(countColumns('\\toprule a & b \\\\ \\midrule \\\\ \\bottomrule')).toBe(2)
  })

  it('is not fooled by an escaped ampersand', () => {
    expect(countColumns('a \\& b & c \\\\')).toBe(2)
  })

  it('ignores an ampersand inside a group', () => {
    expect(countColumns('\\texttt{a & b} & c \\\\')).toBe(2)
  })
})

describe('defaultSpec', () => {
  it('labels the first column and centres the rest', () => {
    expect(defaultSpec(4)).toBe('lccc')
    expect(defaultSpec(1)).toBe('l')
  })

  it('never produces an empty spec', () => {
    expect(defaultSpec(0)).toBe('l')
  })
})

describe('the repair reaching a real document', () => {
  it('is applied on parse, so the file is fixed on the next save', async () => {
    const doc = `\\documentclass{article}
\\begin{document}
\\begin{table}[htbp]
\\caption{Results.}
\\label{tab:regression}
${DAMAGED}
\\end{table}
\\end{document}
`
    const parsed = await parseLatexToDoc(doc)
    const out = serializeDocToLatex(parsed.doc)
    expect(out).toContain('\\begin{tabular}{lccc}')
    // And the rest of the table came back intact.
    expect(out).toContain('\\bottomrule')
    expect(out).toContain('\\label{tab:regression}')
  })
})
