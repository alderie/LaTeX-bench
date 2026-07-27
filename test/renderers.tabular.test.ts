import { describe, it, expect } from 'vitest'
import { isTabularSource, renderTabular } from '@renderer/editor/wysiwyg/renderers/tabular'

// The tabular renderer is what turns a raw `\begin{tabular}` block into a
// readable table in the WYSIWYG view. These cases are the ones that used to
// come out as a wall of literal source.

const booktabs = String.raw`\begin{tabular}{@{}llrr@{}}
  \toprule
  \multirow{2}{*}{Method} & \multicolumn{3}{c}{Benchmark} \\
  \cmidrule(l){2-4}
                          & Split & Error (\%) & Time (s) \\
  \midrule
  Baseline                & dev   & 12.4       & 0.81 \\
                          & test  & 13.1       & 0.79 \\
  \bottomrule
\end{tabular}`

describe('tabular renderer', () => {
  it('recognises the tabular-like environments', () => {
    expect(isTabularSource(booktabs)).toBe(true)
    expect(isTabularSource(String.raw`\begin{tabularx}{\textwidth}{lXX}a & b & c\\\end{tabularx}`)).toBe(true)
    expect(isTabularSource(String.raw`\begin{longtable}[c]{ll}a & b\\\end{longtable}`)).toBe(true)
    expect(isTabularSource(String.raw`\begin{itemize}\item x\end{itemize}`)).toBe(false)
  })

  it('does not read `@{}` in the column spec as a column', () => {
    // `\{[^}]*\}` stopped at the `}` inside `@{}`, so the rest of the spec
    // ("llrr@") was parsed as the table's first row.
    const table = renderTabular(booktabs).querySelector('table')!
    const firstRow = table.querySelector('tr')!
    expect(firstRow.textContent).not.toContain('llrr')
    expect(firstRow.textContent).toContain('Method')
  })

  it('unwraps \\multicolumn and \\multirow to their content', () => {
    const table = renderTabular(booktabs).querySelector('table')!
    const cells = Array.from(table.querySelectorAll('td'))
    const method = cells.find((c) => c.textContent?.includes('Method'))!
    expect(method.textContent?.trim()).toBe('Method')
    expect(method.rowSpan).toBe(2)
    const benchmark = cells.find((c) => c.textContent?.includes('Benchmark'))!
    expect(benchmark.textContent?.trim()).toBe('Benchmark')
    expect(benchmark.colSpan).toBe(3)
  })

  it('drops the placeholder a \\multirow spans over so columns stay aligned', () => {
    const table = renderTabular(booktabs).querySelector('table')!
    const rows = Array.from(table.querySelectorAll('tr'))
    // Row 2 is the sub-header; its first visible cell is "Split", because
    // the "Method" cell above spans down into its first slot.
    const second = Array.from(rows[1].querySelectorAll('td'))
    expect(second[0].textContent?.trim()).toBe('Split')
  })

  it('marks booktabs rules and cmidrule spans', () => {
    const table = renderTabular(booktabs).querySelector('table')!
    const rows = Array.from(table.querySelectorAll('tr'))
    expect(rows[0].className).toContain('top-rule')
    expect(rows[2].className).toContain('mid-rule')
    // `\cmidrule(l){2-4}` underlines columns 2–4 of the header row.
    expect(rows[1].querySelectorAll('.tabular-block__cell--cmid').length).toBeGreaterThan(0)
  })

  it('draws \\hline rules in a classic `|l|c|` table', () => {
    const classic = String.raw`\begin{tabular}{|l|c|}
  \hline
  Symbol & Meaning \\
  \hline
  $x$ & A number \\
  \hline
\end{tabular}`
    const table = renderTabular(classic).querySelector('table')!
    const rows = Array.from(table.querySelectorAll('tr'))
    expect(rows).toHaveLength(2)
    expect(rows[0].className).toContain('rule')
    expect(rows[1].className).toContain('rule')
    expect(rows[0].querySelectorAll('td')).toHaveLength(2)
  })

  it('renders math inside cells', () => {
    const table = renderTabular(
      String.raw`\begin{tabular}{ll}$\alpha$ & first \\\end{tabular}`
    ).querySelector('table')!
    expect(table.querySelector('.katex')).not.toBeNull()
  })
})
