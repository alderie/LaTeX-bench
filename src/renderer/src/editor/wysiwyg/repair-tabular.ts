// Putting back a column spec an earlier build of this editor deleted.
//
// `\begin{tabular}` without its `{lcc}` argument is not a table that renders
// badly — it is a fatal error. LaTeX reads the token *after* `\begin{tabular}`
// as the spec, gets `\toprule`, and stops:
//
//   ! Use of \@array doesn't match its definition.
//   ==> Fatal error occurred, no output PDF file produced!
//
// and because the run dies there, the `.aux` file is never completed, so
// every `\cite` and every `\ref` in the document also reports as undefined.
// One missing brace group produces a screen full of unrelated-looking errors.
//
// Files are in this state in the wild — the table renderer already carries a
// comment saying so — and the damage is not self-healing: the document round
// trips through the editor unchanged, so the error comes back on every build.
// This is the repair, run on load beside the other one.
//
// The original spec is not recoverable. What is recoverable is the shape:
// the number of columns falls out of the rows themselves.

/**
 * Environments whose first mandatory argument is the column spec.
 *
 * `tabular*` and `tabularx` take a width first, so a single brace group
 * there is ambiguous — is it the width or the spec? They are deliberately
 * absent: guessing wrong would move a width into the column spec and break
 * a table that currently works.
 */
const SPEC_FIRST_ENVS = ['tabular', 'array', 'longtable']

const BEGIN_RE = new RegExp(`\\\\begin\\{(${SPEC_FIRST_ENVS.join('|')})\\}`, 'g')

/** Restore a plausible column spec wherever one is missing. */
export function repairMissingColumnSpec(tex: string): string {
  let out = ''
  let cursor = 0
  BEGIN_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = BEGIN_RE.exec(tex)) !== null) {
    const env = match[1]
    const afterBegin = match.index + match[0].length
    // An argument of any kind means the environment is intact. Only a
    // completely argument-less `\begin{tabular}` is unambiguous damage.
    const next = skipSpace(tex, afterBegin)
    if (tex[next] === '{' || tex[next] === '[') continue

    const body = bodyOf(tex, afterBegin, env)
    if (body === null) continue

    const columns = countColumns(tex.slice(afterBegin, body.end))
    out += tex.slice(cursor, afterBegin) + `{${defaultSpec(columns)}}`
    cursor = afterBegin
  }

  return out + tex.slice(cursor)
}

/** `l` for the first column and `c` for the rest — the academic default. */
export function defaultSpec(columns: number): string {
  const count = Math.max(1, columns)
  return 'l' + 'c'.repeat(count - 1)
}

/** Where this environment's `\end` is, so the body can be measured. */
function bodyOf(tex: string, from: number, env: string): { end: number } | null {
  const open = `\\begin{${env}}`
  const close = `\\end{${env}}`
  let depth = 1
  let i = from
  while (i < tex.length) {
    const nextOpen = tex.indexOf(open, i)
    const nextClose = tex.indexOf(close, i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + open.length
      continue
    }
    depth--
    if (depth === 0) return { end: nextClose }
    i = nextClose + close.length
  }
  return null
}

/**
 * How many columns the rows imply — the widest row wins.
 *
 * Rules-only segments (`\toprule`, `\midrule`) are punctuation between rows
 * rather than rows, and counting them as one-column rows would under-report
 * a table whose every row is separated by a rule.
 */
export function countColumns(body: string): number {
  let widest = 0
  for (const row of splitRows(body)) {
    if (isRuleOnly(row)) continue
    widest = Math.max(widest, countCells(row))
  }
  return widest
}

/** Split on `\\` at brace depth zero, the way a row separator works. */
function splitRows(body: string): string[] {
  const rows: string[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        rows.push(body.slice(last, i))
        i += 2
        // A row break can carry an optional `[6pt]`.
        let scan = i
        while (scan < body.length && /[ \t]/.test(body[scan])) scan++
        if (body[scan] === '[') {
          const close = body.indexOf(']', scan)
          if (close !== -1) i = close + 1
        }
        last = i
        continue
      }
      // Any other escape consumes its next character, so `\&` is not a
      // separator and `\{` does not open a group.
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  rows.push(body.slice(last))
  return rows
}

/** Cells in one row: `&` at brace depth zero, plus one. */
function countCells(row: string): number {
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
  // `\multicolumn{3}{c}{…}` occupies three columns while containing no `&`,
  // so a header row written that way would otherwise report as one cell.
  let spanned = 0
  for (const span of row.matchAll(/\\multicolumn\s*\{\s*(\d+)\s*\}/g)) {
    spanned += Number(span[1]) - 1
  }
  return cells + spanned
}

function isRuleOnly(row: string): boolean {
  return (
    row
      .replace(/\\(?:top|mid|bottom)rule(?:\[[^\]]*\])?/g, '')
      .replace(/\\cmidrule(?:\([^)]*\))?(?:\{[^}]*\})?/g, '')
      .replace(/\\hline|\\addlinespace(?:\[[^\]]*\])?|\\noalign\{[^}]*\}/g, '')
      .trim() === ''
  )
}

function skipSpace(text: string, from: number): number {
  let i = from
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}
