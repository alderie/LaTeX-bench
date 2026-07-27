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
 * Which parts of a column spec are columns.
 *
 * Not every letter is one: `@{}` is inter-column material, `>{\bfseries}` is a
 * hook, and `p{3cm}` is a column whose width travels with it. Both growing and
 * shrinking need to know where the columns actually are — appending a letter
 * after a trailing `@{}` prints the new column outside the table's own margin,
 * and dropping a `p` on its own leaves a stray `{3cm}` behind.
 */
function columnSpans(spec: string): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = []
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i]
    if ('@pmbP><!'.includes(c) && spec[i + 1] === '{') {
      let depth = 0
      let j = i + 1
      for (; j < spec.length; j++) {
        if (spec[j] === '{') depth++
        else if (spec[j] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      // A fixed-width column occupies one; the rest is material between them.
      if ('pmbP'.includes(c)) spans.push({ from: i, to: j + 1 })
      i = j
      continue
    }
    if (c === 'l' || c === 'c' || c === 'r' || c === 'X') spans.push({ from: i, to: i + 1 })
  }
  return spans
}

/** One more column in a spec, matching whatever the last real column was. */
export function growColumnSpec(spec: string): string {
  const spans = columnSpans(spec)
  const last = spans[spans.length - 1]
  if (!last) return spec + 'l'
  const column = spec.slice(last.from, last.to)
  return `${spec.slice(0, last.to)}${column}${spec.slice(last.to)}`
}

/** One fewer, so a spec doesn't outlive the column it described. */
export function shrinkColumnSpec(spec: string): string {
  const spans = columnSpans(spec)
  const last = spans[spans.length - 1]
  if (!last || spans.length <= 1) return spec
  return spec.slice(0, last.from) + spec.slice(last.to)
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

/**
 * Drop the last row that holds content.
 *
 * The row's own leading newline goes with it, and the rule under it stays
 * where it was: what is being removed is a row, not the floor beneath it.
 */
export function removeTabularRow(source: string): string {
  const split = splitTabularSource(source)
  if (!split) return source
  const spans = rowSpans(split.body)
  const content = spans.filter((span) => !isRuleOnly(split.body.slice(span.from, span.to)))
  if (content.length <= 1) return source

  const last = content[content.length - 1]
  // A rule at the head of the segment belongs to the table, not to the row:
  // deleting the only row under a `\midrule` should not take the rule with
  // it, or adding a row back would leave the table without its divider.
  const rules = consumeLeadingRules(split.body.slice(last.from, last.to)).at
  const before = split.body.slice(0, last.from + rules).replace(/[ \t]+$/, '')
  const after = split.body.slice(last.to + last.separator.length)
  return `${split.prefix}${before}${joinAfterCut(before, after)}${split.suffix}`
}

/** Close the gap a removed row leaves, without eating the next line's own. */
function joinAfterCut(before: string, after: string): string {
  return before.endsWith('\n') ? after.replace(/^[ \t]*\n/, '') : after
}

/** The last top-level `&` in a row, which is where its last cell begins. */
function lastCellStart(row: string): number {
  let depth = 0
  let at = -1
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '&' && depth === 0) at = i
  }
  return at
}

/** Drop the last cell of every row, and the column it filled in the spec. */
export function removeTabularColumn(source: string): string {
  const split = splitTabularSource(source)
  if (!split) return source
  if (tabularColumnCount(source) <= 1) return source
  let body = split.body
  // Back to front, so an earlier splice can't shift a later one's offsets.
  for (const span of rowSpans(body).slice().reverse()) {
    const row = body.slice(span.from, span.to)
    if (isRuleOnly(row)) continue
    const at = lastCellStart(row)
    if (at === -1) continue
    // One space back before the `\\` the row still ends with, so the source
    // reads the way the author wrote it rather than `Acc\\`.
    const kept = row.slice(0, at).replace(/\s*$/, '') + (span.separator === '' ? '' : ' ')
    body = `${body.slice(0, span.from)}${kept}${body.slice(span.to)}`
  }
  return `${withColumnSpec(split.prefix, shrinkColumnSpec(split.colSpec))}${body}${split.suffix}`
}

/**
 * Resize the table to a shape the author asked for.
 *
 * Growing is what this is mostly for — the new rows and columns arrive empty,
 * to be filled in the rendering — but it shrinks too, and shrinking discards
 * whatever was in what it removes. That is what the editor's undo is for; the
 * alternative, refusing to shrink a table that has anything in it, would mean
 * the number in the header is only editable upwards.
 */
export function setTabularShape(
  source: string,
  shape: { rows?: number; columns?: number }
): string {
  if (!splitTabularSource(source)) return source
  let next = source

  // Columns first: a row added afterwards is then born the right width.
  if (shape.columns !== undefined) {
    const target = Math.max(1, Math.floor(shape.columns))
    for (let guard = 0; tabularColumnCount(next) < target && guard < 64; guard++) {
      next = addTabularColumn(next)
    }
    for (let guard = 0; tabularColumnCount(next) > target && guard < 64; guard++) {
      const shrunk = removeTabularColumn(next)
      if (shrunk === next) break
      next = shrunk
    }
  }

  if (shape.rows !== undefined) {
    const target = Math.max(1, Math.floor(shape.rows))
    for (let guard = 0; tabularShape(next).rows < target && guard < 256; guard++) {
      next = addTabularRow(next)
    }
    for (let guard = 0; tabularShape(next).rows > target && guard < 256; guard++) {
      const shrunk = removeTabularRow(next)
      if (shrunk === next) break
      next = shrunk
    }
  }
  return next
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
