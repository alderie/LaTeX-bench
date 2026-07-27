// Growing and reshaping a `tabular`, as source-to-source rewrites.
//
// The table editor's row and column buttons are the reason this exists. A
// table is stored as raw LaTeX — that is what makes `\multicolumn`, booktabs
// rules and `@{}` column material survive a round-trip — so "add a column"
// cannot be a structural operation on a parsed model that is then re-printed:
// re-printing would reformat every table it touched, and a reformatted table
// is a diff in the author's `.tex` that they did not ask for.
//
// So the rewrites are surgical. Rows and cells are located by offset in the
// original text and material is spliced in at those offsets; everything the
// author wrote outside the splice comes back byte for byte.
//
// Pure string work, no DOM — the awkward parts (a `\\` inside a nested
// `\begin{tabular}`, a rule-only segment that is punctuation rather than a
// row) are testable without a browser.

import { consumeLeadingRules, splitTabularSource } from './tabular'

interface Span {
  from: number
  to: number
  /** The row separator that closed this segment, if any. */
  separator: string
}

/**
 * The body's rows, as offsets. A row is everything up to the `\\` that ends
 * it; the final segment (usually holding `\bottomrule`) is included, because
 * knowing where it starts is how a new row gets inserted *above* it.
 */
function rowSpans(body: string): Span[] {
  const spans: Span[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        let end = i + 2
        // A row break may carry an optional `[6pt]`, which belongs to the
        // separator rather than to the row after it.
        let scan = end
        while (scan < body.length && /[ \t]/.test(body[scan])) scan++
        if (body[scan] === '[') {
          const close = body.indexOf(']', scan)
          if (close !== -1) end = close + 1
        }
        spans.push({ from: last, to: i, separator: body.slice(i, end) })
        i = end
        last = i
        continue
      }
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  spans.push({ from: last, to: body.length, separator: '' })
  return spans
}

/** Cell boundaries inside one row, as offsets into that row's text. */
function cellCount(row: string): number {
  let depth = 0
  let cells = 1
  let i = 0
  while (i < row.length) {
    const c = row[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '&' && depth === 0) cells++
    i++
  }
  return cells
}

/** True for a segment that is only rules and whitespace — punctuation. */
function isRuleOnly(row: string): boolean {
  return consumeLeadingRules(row).rest.trim() === ''
}

/** Widest row in the table, which is how many cells a new row needs. */
export function tabularColumnCount(source: string): number {
  const split = splitTabularSource(source)
  if (!split) return 0
  const rows = rowSpans(split.body)
    .map((span) => split.body.slice(span.from, span.to))
    .filter((row) => !isRuleOnly(row))
  const fromRows = rows.length > 0 ? Math.max(...rows.map(cellCount)) : 0
  return Math.max(1, fromRows)
}

/** The indentation the table's own rows use, so a new one matches. */
function rowIndent(body: string): string {
  for (const line of body.split('\n')) {
    const match = /^([ \t]+)\S/.exec(line)
    if (match) return match[1]
  }
  return '  '
}

/**
 * Append an empty row.
 *
 * Above the closing rule, not below it: a `\bottomrule` under the last row is
 * the table's floor, and a row added beneath it renders outside the frame —
 * which looks like a bug in the editor rather than an empty row.
 */
export function addTabularRow(source: string): string {
  const split = splitTabularSource(source)
  if (!split) return source
  const columns = tabularColumnCount(source)
  const blank = Array.from({ length: columns }, () => '').join(' & ').trim()
  const indent = rowIndent(split.body)
  const spans = rowSpans(split.body)
  const last = spans[spans.length - 1]
  const trailing = split.body.slice(last.from)

  const body =
    isRuleOnly(trailing) && spans.length > 1
      ? // Above the closing rule, on a line of its own — the trailing segment
        // keeps whatever leading newline it already had.
        `${split.body.slice(0, last.from)}\n${indent}${blank} \\\\${trailing}`
      : `${split.body.replace(/\s*$/, '')} \\\\\n${indent}${blank}\n`

  return `${split.prefix}${body}${split.suffix}`
}

/**
 * Append an empty cell to every row, and a column to the spec.
 *
 * Rows are rewritten back to front so an earlier splice can't shift the
 * offsets of a later one.
 */
export function addTabularColumn(source: string): string {
  const split = splitTabularSource(source)
  if (!split) return source
  let body = split.body
  for (const span of rowSpans(body).slice().reverse()) {
    const row = body.slice(span.from, span.to)
    if (isRuleOnly(row)) continue
    const trimmed = row.replace(/\s*$/, '')
    body = `${body.slice(0, span.from)}${trimmed} & ${body.slice(span.to)}`
  }
  return `${withColumnSpec(split.prefix, growColumnSpec(split.colSpec))}${body}${split.suffix}`
}

/**
 * One more column in a spec, matching whatever the last real column was.
 *
 * Appended after the last alignment letter rather than at the end of the
 * string: booktabs specs habitually end in `@{}`, which is inter-column
 * material and not a column, and a letter after it would print the new column
 * outside the table's own margin.
 */
export function growColumnSpec(spec: string): string {
  const letters = /[lcrX]/g
  let lastIndex = -1
  let lastChar = 'l'
  let match: RegExpExecArray | null
  while ((match = letters.exec(spec)) !== null) {
    // `p{3cm}`-style columns carry an argument the letter class can't see;
    // `@{...}` groups are skipped by only ever matching column letters.
    lastIndex = match.index
    lastChar = match[0]
  }
  if (lastIndex === -1) return spec + 'l'
  return `${spec.slice(0, lastIndex + 1)}${lastChar}${spec.slice(lastIndex + 1)}`
}

/**
 * Replace the column spec inside a `\begin{tabular}{…}` prefix.
 *
 * The spec is the last *balanced* brace group, which is not the same as the
 * text between the last `{` and the last `}`: a booktabs spec is `{@{}lcc@{}}`
 * and contains two groups of its own, so the naive read produces
 * `{@{}lcc@{<new spec>}}` — a table with a column named after its own spec.
 */
export function withColumnSpec(prefix: string, spec: string): string {
  const close = prefix.lastIndexOf('}')
  if (close === -1) return prefix
  let depth = 0
  for (let i = close; i >= 0; i--) {
    if (prefix[i] === '}') depth++
    else if (prefix[i] === '{') {
      depth--
      if (depth === 0) return `${prefix.slice(0, i + 1)}${spec}${prefix.slice(close)}`
    }
  }
  return prefix
}

/** Swap the column spec of a whole tabular source. */
export function setTabularColumnSpec(source: string, spec: string): string {
  const split = splitTabularSource(source)
  if (!split) return source
  return `${withColumnSpec(split.prefix, spec)}${split.body}${split.suffix}`
}

/** The declared column spec, for a control that shows it. */
export function tabularColumnSpec(source: string): string {
  return splitTabularSource(source)?.colSpec ?? ''
}

/** Rows and columns, for a note on the editor's bar. */
export function tabularShape(source: string): { rows: number; columns: number } {
  const split = splitTabularSource(source)
  if (!split) return { rows: 0, columns: 0 }
  const rows = rowSpans(split.body)
    .map((span) => split.body.slice(span.from, span.to))
    .filter((row) => !isRuleOnly(row))
  return { rows: rows.length, columns: tabularColumnCount(source) }
}
