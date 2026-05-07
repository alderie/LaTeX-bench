import { renderInlineLatex } from './inline-render'

// Detect a tabular environment in the source. Returns null if the source
// isn't a (single, top-level) tabular.
const TABULAR_RE = /^\s*\\begin\{(tabular\*?)\}\s*(?:\{[^}]*\})?\s*([\s\S]*?)\\end\{\1\}\s*$/

export function isTabularSource(source: string): boolean {
  return TABULAR_RE.test(source.trim())
}

interface Cell {
  content: string
  span: number
  align: Align
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
function splitRows(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        out.push(body.slice(last, i))
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
  out.push(body.slice(last))
  return out
}

// Brace-depth-aware splitter on `&` for cell separation.
function splitCells(rowText: string): string[] {
  const out: string[] = []
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
      out.push(rowText.slice(last, i))
      last = i + 1
    }
    i++
  }
  out.push(rowText.slice(last))
  return out
}

// Strip a leading rule directive from a row segment. Returns the macro it
// found (if any) and the remaining text.
function consumeLeadingRules(s: string): {
  rule?: 'top' | 'mid' | 'bottom'
  cmids: CmidRule[]
  rest: string
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
    const cmid = /^\\cmidrule(?:\([^)]*\))?\{(\d+)\s*-\s*(\d+)\}/.exec(rest)
    if (cmid) {
      cmids.push({ from: parseInt(cmid[1], 10), to: parseInt(cmid[2], 10) })
      rest = rest.slice(cmid[0].length).trimStart()
      continue
    }
    break
  }
  return { rule, cmids, rest }
}

function parseColSpec(spec: string): Align[] {
  const out: Align[] = []
  for (const c of spec) {
    if (c === 'l' || c === 'c' || c === 'r') out.push(c)
    // Ignore vertical-rule and length tokens (`|`, `*{n}{...}`, `p{w}`,
    // `m{w}`, `b{w}`) — column spec parsing is best-effort here.
  }
  return out
}

// `\multicolumn{n}{align}{content}` — parse out span/align/content if the
// cell IS a multicolumn, otherwise return null.
function parseMulticolumn(cellText: string): { span: number; align: Align; content: string } | null {
  const m = /^\s*\\multicolumn\{(\d+)\}\{([^}]*)\}\{/.exec(cellText)
  if (!m) return null
  const span = parseInt(m[1], 10) || 1
  const alignSpec = m[2]
  const align: Align = alignSpec.includes('c') ? 'c' : alignSpec.includes('r') ? 'r' : 'l'
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
        return { span, align, content: cellText.slice(contentStart, i) }
      }
    }
    i++
  }
  return null
}

function parseTabular(source: string): ParsedTabular | null {
  const m = TABULAR_RE.exec(source.trim())
  if (!m) return null
  const colSpecMatch = /\\begin\{tabular\*?\}\s*(?:\{([^}]*)\})?/.exec(source)
  const colSpec = parseColSpec(colSpecMatch?.[1] ?? '')
  const body = m[2]
  const rowSegs = splitRows(body)

  const rows: ParsedRow[] = []
  let pendingRule: 'top' | 'mid' | 'bottom' | undefined
  let pendingCmids: CmidRule[] = []
  let bottomRule: 'top' | 'mid' | 'bottom' | undefined
  let bottomCmids: CmidRule[] = []

  for (let idx = 0; idx < rowSegs.length; idx++) {
    const { rule, cmids, rest } = consumeLeadingRules(rowSegs[idx])
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

    const cellTexts = splitCells(rest)
    const cells: Cell[] = cellTexts.map((t, i) => {
      const mc = parseMulticolumn(t)
      if (mc) {
        return { content: mc.content.trim(), span: mc.span, align: mc.align }
      }
      // Default align: explicit colspec wins; otherwise left for the first
      // column, centre for subsequent columns (a typical results table).
      const fallback: Align = i === 0 ? 'l' : 'c'
      return { content: t.trim(), span: 1, align: colSpec[i] ?? fallback }
    })
    rows.push({
      cells,
      ruleAbove: pendingRule,
      cmidsAbove: pendingCmids.length ? pendingCmids : undefined
    })
    pendingRule = undefined
    pendingCmids = []
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

export function renderTabular(source: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'tabular-block-wrapper'
  const parsed = parseTabular(source)
  if (!parsed) {
    wrapper.textContent = source
    return wrapper
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
      tr.appendChild(td)
      colCursor += cell.span
    }
    table.appendChild(tr)
  }

  if (parsed.bottomRule === 'bottom' && table.lastElementChild) {
    table.lastElementChild.classList.add('tabular-block__row--has-bottom-rule')
  }

  wrapper.appendChild(table)
  return wrapper
}
