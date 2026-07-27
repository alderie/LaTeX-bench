import { renderInlineLatex } from './inline-render'
import { markCell, type CellSite } from '../editors/cell-editor'

// Tabular-like environments we can lay out as a real HTML table.
const TABULAR_ENVS = ['tabular', 'tabular*', 'tabularx', 'longtable', 'array']

// Splitting the header off can't be done with a regex: a booktabs column
// spec is `{@{}llrr@{}}`, and `\{[^}]*\}` stops at the first `}` inside
// `@{}` — which is how the whole spec used to end up rendered as a table
// row reading "llrr@".
export interface TabularSource {
  env: string
  colSpec: string
  body: string
  /** Everything before the body, verbatim: `\begin{tabular}{@{}ll@{}}`. */
  prefix: string
  /** Everything after it, verbatim. */
  suffix: string
  /**
   * Where the body starts in the string that was passed in — including any
   * whitespace trimmed off the front of it. Cells are located by offset so
   * that editing one leaves every other byte of the table alone.
   */
  bodyFrom: number
}

export function splitTabularSource(source: string): TabularSource | null {
  const text = source.trim()
  const lead = source.length - source.trimStart().length
  const open = /^\\begin\{([A-Za-z]+\*?)\}/.exec(text)
  if (!open || !TABULAR_ENVS.includes(open[1])) return null
  const env = open[1]
  const close = `\\end{${env}}`
  if (!text.endsWith(close)) return null

  // Consume the environment's arguments. The column spec is the last
  // brace group before the body — `tabularx` and `tabular*` take a width
  // first, `longtable` an optional `[c]`.
  let i = open[0].length
  const groups: string[] = []
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    const openMark = text[i]
    if (openMark !== '{' && openMark !== '[') break
    const closeMark = openMark === '{' ? '}' : ']'
    let depth = 0
    let j = i
    for (; j < text.length; j++) {
      const c = text[j]
      if (c === '\\') {
        j++
        continue
      }
      if (c === openMark) depth++
      else if (c === closeMark) {
        depth--
        if (depth === 0) break
      }
    }
    if (j >= text.length) return null
    if (openMark === '{') groups.push(text.slice(i + 1, j))
    i = j + 1
  }
  // No column spec at all. That's malformed LaTeX — but files in the wild
  // are in exactly this state (an older build of this editor deleted the
  // spec on save), and refusing to render leaves the user staring at a wall
  // of `&` and `\\`. Render it anyway and let the column count fall out of
  // the rows themselves.
  return {
    env,
    colSpec: groups.length > 0 ? groups[groups.length - 1] : '',
    body: text.slice(i, text.length - close.length),
    prefix: text.slice(0, i),
    suffix: close,
    bodyFrom: lead + i
  }
}

export function isTabularSource(source: string): boolean {
  return splitTabularSource(source) !== null
}

interface Cell {
  content: string
  span: number
  rowSpan: number
  align: Align
  /**
   * Offsets of the cell's editable text in the source — the argument of a
   * `\multicolumn`, not the macro around it. What makes clicking a rendered
   * cell an edit to the table rather than a re-print of it.
   */
  from: number
  to: number
  /** The cell's place in its row, kept because `rowspan` removes some. */
  column: number
}

/** A stretch of the source, so what was parsed can be found again. */
interface Segment {
  text: string
  from: number
}
type Align = 'l' | 'c' | 'r'
interface CmidRule {
  from: number
  to: number
}
interface ParsedRow {
  cells: Cell[]
  // Rule that sits ABOVE this row (drawn on the row's top border).
  ruleAbove?: 'top' | 'mid' | 'bottom'
  cmidsAbove?: CmidRule[]
}

interface ParsedTabular {
  rows: ParsedRow[]
  bottomRule?: 'top' | 'mid' | 'bottom'
  bottomCmids?: CmidRule[]
  numCols: number
  colSpec: Align[]
}

// Brace-depth-aware splitter on a literal two-character `\\` row separator.
function splitRows(body: string): Segment[] {
  const out: Segment[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        out.push({ text: body.slice(last, i), from: last })
        i += 2
        // Skip optional `[Npt]` spacing arg after `\\`.
        while (i < body.length && /\s/.test(body[i])) i++
        if (body[i] === '[') {
          const close = body.indexOf(']', i)
          if (close !== -1) i = close + 1
        }
        last = i
        continue
      }
      if (body[i + 1] === '{' || body[i + 1] === '}') {
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  out.push({ text: body.slice(last), from: last })
  return out
}

// Brace-depth-aware splitter on `&` for cell separation.
function splitCells(rowText: string): Segment[] {
  const out: Segment[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < rowText.length) {
    const c = rowText[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '&' && depth === 0) {
      out.push({ text: rowText.slice(last, i), from: last })
      last = i + 1
    }
    i++
  }
  out.push({ text: rowText.slice(last), from: last })
  return out
}

// Strip a leading rule directive from a row segment. Returns the macro it
// found (if any) and the remaining text.
export function consumeLeadingRules(s: string): {
  rule?: 'top' | 'mid' | 'bottom'
  cmids: CmidRule[]
  rest: string
  /** Where `rest` starts in `s`, so the cells after it can be located. */
  at: number
} {
  const cmids: CmidRule[] = []
  let rule: 'top' | 'mid' | 'bottom' | undefined
  let rest = s.trimStart()
  // Loop because a row segment can carry multiple rule directives at its
  // head (`\midrule \cmidrule(lr){2-4}`).
  while (true) {
    const top = /^\\toprule\b/.exec(rest)
    if (top) {
      rule = 'top'
      rest = rest.slice(top[0].length).trimStart()
      continue
    }
    const mid = /^\\midrule\b/.exec(rest)
    if (mid) {
      rule = 'mid'
      rest = rest.slice(mid[0].length).trimStart()
      continue
    }
    const bot = /^\\bottomrule\b/.exec(rest)
    if (bot) {
      rule = 'bottom'
      rest = rest.slice(bot[0].length).trimStart()
      continue
    }
    // `\hline` is the classic (non-booktabs) rule. Without it a `|l|c|`
    // table rendered as bare text with no grid at all.
    const hline = /^\\hline\b/.exec(rest)
    if (hline) {
      rule = rule ?? 'mid'
      rest = rest.slice(hline[0].length).trimStart()
      continue
    }
    const cmid = /^\\cmidrule(?:\([^)]*\))?\{(\d+)\s*-\s*(\d+)\}/.exec(rest)
    if (cmid) {
      cmids.push({ from: parseInt(cmid[1], 10), to: parseInt(cmid[2], 10) })
      rest = rest.slice(cmid[0].length).trimStart()
      continue
    }
    break
  }
  return { rule, cmids, rest, at: s.length - rest.length }
}

function parseColSpec(spec: string): Align[] {
  const out: Align[] = []
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i]
    // Tokens that take a brace argument: `@{…}` (inter-column material),
    // `p{w}`/`m{w}`/`b{w}` (fixed width), `>{…}`/`<{…}` (array package
    // hooks). Skip the argument, or its contents get read as columns —
    // `@{}llrr@{}` used to yield a phantom leading column.
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
      // `p{w}`-style columns still occupy a column; `@{}`/`>{}`/`<{}` don't.
      if ('pmbP'.includes(c)) out.push('l')
      i = j
      continue
    }
    if (c === 'l' || c === 'c' || c === 'r') out.push(c)
    if (c === 'X') out.push('l') // tabularx flexible column
    // `|` and whitespace carry no column of their own.
  }
  return out
}

// `\multicolumn{n}{align}{content}` and `\multirow{n}{width}{content}` —
// the two cell macros that carry their payload in a trailing brace group.
// Left unparsed, the whole macro used to render as literal text: a header
// cell reading "2*Method" instead of "Method".
function parseSpanningCell(cellText: string): {
  span: number
  rowSpan: number
  align: Align | null
  content: string
  /** Offsets of the content argument within `cellText`. */
  from: number
  to: number
} | null {
  const mc = /^\s*\\multicolumn\{(\d+)\}\{([^}]*)\}\{/.exec(cellText)
  const mr = /^\s*\\multirow\*?(?:\[[^\]]*\])?\{(\d+)\}(?:\[[^\]]*\])?\{[^{}]*\}(?:\[[^\]]*\])?\{/.exec(
    cellText
  )
  const m = mc ?? mr
  if (!m) return null
  const count = parseInt(m[1], 10) || 1
  const span = mc ? count : 1
  const rowSpan = mc ? 1 : count
  const alignSpec = mc ? m[2] : ''
  const align: Align | null = mc
    ? alignSpec.includes('c')
      ? 'c'
      : alignSpec.includes('r')
        ? 'r'
        : 'l'
    : null
  const contentStart = m[0].length
  // Find matching close brace for the content arg.
  let depth = 1
  let i = contentStart
  while (i < cellText.length) {
    const c = cellText[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        return {
          span,
          rowSpan,
          align,
          content: cellText.slice(contentStart, i),
          from: contentStart,
          to: i
        }
      }
    }
    i++
  }
  return null
}

/** A cell's text without the padding around it, as offsets in the source. */
function trimmedSpan(text: string, at: number): { from: number; to: number } {
  const from = at + (text.length - text.trimStart().length)
  return { from, to: Math.max(from, at + text.trimEnd().length) }
}

function parseTabular(source: string): ParsedTabular | null {
  const split = splitTabularSource(source)
  if (!split) return null
  const colSpec = parseColSpec(split.colSpec)
  const rowSegs = splitRows(split.body)

  const rows: ParsedRow[] = []
  let pendingRule: 'top' | 'mid' | 'bottom' | undefined
  let pendingCmids: CmidRule[] = []
  let bottomRule: 'top' | 'mid' | 'bottom' | undefined
  let bottomCmids: CmidRule[] = []

  for (let idx = 0; idx < rowSegs.length; idx++) {
    const segment = rowSegs[idx]
    const { rule, cmids, rest, at } = consumeLeadingRules(segment.text)
    if (rule) pendingRule = rule
    if (cmids.length) pendingCmids = pendingCmids.concat(cmids)

    // Trailing empty segment after the last `\\` is the place where
    // `\bottomrule` typically lives — capture it as the table's bottom rule.
    if (rest.trim().length === 0) {
      if (idx === rowSegs.length - 1) {
        bottomRule = pendingRule
        bottomCmids = pendingCmids
        pendingRule = undefined
        pendingCmids = []
      }
      continue
    }

    // Where this row's text sits in the source the caller passed in, which is
    // what every cell's offsets are measured against.
    const rowFrom = split.bodyFrom + segment.from + at
    const cells: Cell[] = splitCells(rest).map((cellSeg, i) => {
      // Default align: explicit colspec wins; otherwise left for the first
      // column, centre for subsequent columns (a typical results table).
      const fallback: Align = i === 0 ? 'l' : 'c'
      const at = rowFrom + cellSeg.from
      const spanning = parseSpanningCell(cellSeg.text)
      if (spanning) {
        return {
          content: spanning.content.trim(),
          span: spanning.span,
          rowSpan: spanning.rowSpan,
          align: spanning.align ?? colSpec[i] ?? fallback,
          ...trimmedSpan(spanning.content, at + spanning.from),
          column: i
        }
      }
      return {
        content: cellSeg.text.trim(),
        span: 1,
        rowSpan: 1,
        align: colSpec[i] ?? fallback,
        ...trimmedSpan(cellSeg.text, at),
        column: i
      }
    })
    rows.push({
      cells,
      ruleAbove: pendingRule,
      cmidsAbove: pendingCmids.length ? pendingCmids : undefined
    })
    pendingRule = undefined
    pendingCmids = []
  }

  // A `\multirow{2}` cell leaves the same slot empty in the row below it.
  // HTML's rowspan fills that slot itself, so the empty placeholder has to
  // go or every later cell in the row shifts one column right.
  for (let r = 0; r < rows.length; r++) {
    let col = 0
    for (const cell of rows[r].cells) {
      if (cell.rowSpan > 1) {
        for (let k = r + 1; k < Math.min(rows.length, r + cell.rowSpan); k++) {
          const target = rows[k]
          let c = 0
          for (let ci = 0; ci < target.cells.length; ci++) {
            if (c === col && target.cells[ci].content === '') {
              target.cells.splice(ci, 1)
              break
            }
            c += target.cells[ci].span
          }
        }
      }
      col += cell.span
    }
  }

  // Width = max cell-spans-summed across rows, since some rows have
  // multicolumn cells that span many columns.
  let numCols = colSpec.length
  for (const r of rows) {
    const w = r.cells.reduce((acc, c) => acc + c.span, 0)
    if (w > numCols) numCols = w
  }

  return { rows, bottomRule, bottomCmids, numCols, colSpec }
}

/** Where a cell with nothing in it is, for a surface that wants to show it. */
function blankMarker(): HTMLElement {
  const marker = document.createElement('span')
  marker.className = 'cell-blank'
  return marker
}

export interface TabularRendering {
  dom: HTMLElement
  /** Every cell, tagged with the source it came from — see `CellEditor`. */
  cells: CellSite[]
}

export function renderTabular(source: string): HTMLElement {
  return renderEditableTabular(source).dom
}

/**
 * The table, with each `<td>` carrying the offsets of the cell it was drawn
 * from. The document's own tables are rendered by this too — a `data-` pair
 * on a cell costs nothing until an editor picks it up.
 */
export function renderEditableTabular(source: string): TabularRendering {
  const wrapper = document.createElement('div')
  wrapper.className = 'tabular-block-wrapper'
  const cells: CellSite[] = []
  const parsed = parseTabular(source)
  if (!parsed) {
    wrapper.textContent = source
    return { dom: wrapper, cells }
  }
  const table = document.createElement('table')
  table.className = 'tabular-block'

  for (let r = 0; r < parsed.rows.length; r++) {
    const row = parsed.rows[r]
    const tr = document.createElement('tr')
    if (row.ruleAbove === 'top') tr.classList.add('tabular-block__row--top-rule')
    else if (row.ruleAbove === 'mid') tr.classList.add('tabular-block__row--mid-rule')
    else if (row.ruleAbove === 'bottom') tr.classList.add('tabular-block__row--bottom-rule')

    // Apply cmidrule(lr){a-b} as a top border on the cells in [a, b].
    const cmidCols = new Set<number>()
    for (const c of row.cmidsAbove ?? []) {
      for (let k = c.from; k <= c.to; k++) cmidCols.add(k)
    }

    let colCursor = 1
    for (const cell of row.cells) {
      const td = document.createElement('td')
      td.colSpan = cell.span
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan
      td.style.textAlign = cell.align === 'c' ? 'center' : cell.align === 'r' ? 'right' : 'left'
      // The cell is covered by a cmidrule if ANY of its sub-columns are.
      let coveredByCmid = false
      for (let k = colCursor; k < colCursor + cell.span; k++) {
        if (cmidCols.has(k)) {
          coveredByCmid = true
          break
        }
      }
      if (coveredByCmid) td.classList.add('tabular-block__cell--cmid')
      td.appendChild(renderInlineLatex(cell.content))
      // An empty cell draws nothing, which in a rendering that can be edited
      // is nothing to aim at — a table resized from 2×3 to 4×5 would show two
      // rows and a gap. The marker is inert until an editor's CSS gives it a
      // size; in the document, an empty cell stays empty.
      if (cell.content === '') td.appendChild(blankMarker())
      cells.push(
        markCell(td, { grid: 0, row: r, column: cell.column, from: cell.from, to: cell.to })
      )
      tr.appendChild(td)
      colCursor += cell.span
    }
    table.appendChild(tr)
  }

  if (parsed.bottomRule === 'bottom' && table.lastElementChild) {
    table.lastElementChild.classList.add('tabular-block__row--has-bottom-rule')
  }

  wrapper.appendChild(table)
  return { dom: wrapper, cells }
}
