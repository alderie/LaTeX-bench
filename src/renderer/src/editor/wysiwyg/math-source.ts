// Taking a display-math block apart so it can be edited as maths rather
// than as a block of LaTeX.
//
// The node stores a formula the way the document wrote it — wrapper and all:
//
//     \begin{equation}
//       \label{eq:bregman}
//       D_\psi(x, y) \coloneqq \psi(x) - \psi(y)
//     \end{equation}
//
// Handing that whole string to a textarea makes the author edit around three
// lines of boilerplate to change one symbol, and makes "unnumber this" a
// retyping exercise in two places at once. Splitting it into shell + body
// lets the editor put the environment on a dropdown, the label in a field,
// and only the maths in the text area.
//
// Everything here is pure string work: no DOM, no KaTeX. That keeps the
// awkward parts — brace-aware splitting, where a `\\` ends a row, what
// counts as a detachable label — testable without a browser.

export type ShellKind = 'env' | 'bracket' | 'bare'

export interface MathShell {
  kind: ShellKind
  /** Environment name without its star, or '' for `\[…\]` and bare source. */
  env: string
  starred: boolean
  /** Everything before the body, verbatim: `\begin{align}`, `\[`, `$$`. */
  before: string
  /** Everything after the body, verbatim. */
  after: string
  /** The maths itself — what the author actually edits. */
  body: string
  /** A `\label{…}` lifted out of the body, when it was safe to lift. */
  label: string | null
  /** Where the lifted label sat, so putting it back doesn't reorder source. */
  labelPlacement: 'leading' | 'trailing'
  /** Indentation to restore when rebuilding a multi-line body. */
  indent: string
}

/**
 * Environments the editor offers in its dropdown. Anything outside this list
 * (`subequations`, `alignat`, a custom theorem-ish wrapper) is left alone —
 * the author can still edit the body, they just don't get a switcher that
 * would mangle an environment we don't understand the arity of.
 */
export const ENV_CHOICES: Array<{ value: string; label: string }> = [
  { value: '\\[', label: 'Display' },
  { value: 'equation', label: 'Equation (numbered)' },
  { value: 'equation*', label: 'Equation' },
  { value: 'align', label: 'Align (numbered)' },
  { value: 'align*', label: 'Align' },
  { value: 'gather', label: 'Gather (numbered)' },
  { value: 'gather*', label: 'Gather' },
  { value: 'multline', label: 'Multline (numbered)' },
  { value: 'multline*', label: 'Multline' }
]

const SWITCHABLE = new Set(ENV_CHOICES.map((c) => c.value))

/** Environments laid out as a grid, where `&` and `\\` mean something. */
export const GRID_ENVIRONMENTS = new Set([
  'align',
  'aligned',
  'alignat',
  'array',
  'bmatrix',
  'Bmatrix',
  'cases',
  'gather',
  'gathered',
  'matrix',
  'pmatrix',
  'smallmatrix',
  'split',
  'vmatrix',
  'Vmatrix'
])

// ── Splitting the wrapper off ──────────────────────────────────────────

// Environment arguments (`{cc}` of an `array`, `{2}` of an `alignat`) are
// matched only on the `\begin` line: allowing a newline in between would let
// a body that opens with `{x + y}` be mistaken for an argument.
const ENV_RE =
  /^(\s*)\\begin\{([a-zA-Z]+)(\*?)\}((?:[ \t]*(?:\[[^\]]*\]|\{[^}]*\}))*)([\s\S]*?)\\end\{\2\*?\}(\s*)$/
const BRACKET_RE = /^(\s*)\\\[([\s\S]*?)\\\](\s*)$/
const DOLLARS_RE = /^(\s*)\$\$([\s\S]*?)\$\$(\s*)$/

export function parseMathShell(latex: string): MathShell {
  const env = ENV_RE.exec(latex)
  if (env) {
    const [, lead, name, star, args, body, trail] = env
    return withLabel({
      kind: 'env',
      env: name,
      starred: star === '*',
      before: `${lead}\\begin{${name}${star}}${args}`,
      after: `\\end{${name}${star}}${trail}`,
      body,
      label: null,
      labelPlacement: 'leading',
      indent: indentOf(body)
    })
  }

  const bracket = BRACKET_RE.exec(latex)
  if (bracket) {
    const [, lead, body, trail] = bracket
    return withLabel({
      kind: 'bracket',
      env: '',
      starred: true,
      before: `${lead}\\[`,
      after: `\\]${trail}`,
      body,
      label: null,
      labelPlacement: 'leading',
      indent: indentOf(body)
    })
  }

  const dollars = DOLLARS_RE.exec(latex)
  if (dollars) {
    const [, lead, body, trail] = dollars
    return withLabel({
      kind: 'bracket',
      env: '',
      starred: true,
      before: `${lead}$$`,
      after: `$$${trail}`,
      body,
      label: null,
      labelPlacement: 'leading',
      indent: indentOf(body)
    })
  }

  return {
    kind: 'bare',
    env: '',
    starred: true,
    before: '',
    after: '',
    body: latex,
    label: null,
    labelPlacement: 'leading',
    indent: indentOf(latex)
  }
}

/** The dropdown value matching a shell, or null when it isn't switchable. */
export function shellChoice(shell: MathShell): string | null {
  if (shell.kind === 'bracket') return '\\['
  if (shell.kind !== 'env') return null
  const value = shell.env + (shell.starred ? '*' : '')
  return SWITCHABLE.has(value) ? value : null
}

/**
 * The body as the author should see it: no wrapper indentation, no blank
 * lines top and tail. Editing `  D_\psi(x,y)` with the file's indentation
 * baked in means every new line has to be indented by hand to match.
 */
export function presentBody(shell: MathShell): string {
  const lines = shell.body
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '')
    .split('\n')
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => (/^[ \t]*/.exec(line)?.[0] ?? '').length)
  const common = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(common)).join('\n')
}

/** Rebuild the full node source from a shell and an edited, dedented body. */
export function serializeMathShell(shell: MathShell, presented = presentBody(shell)): string {
  const withLabel = reinsertLabel(shell, presented)
  if (shell.kind === 'bare') return withLabel
  const body = withLabel
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : shell.indent + line))
    .join('\n')
  return `${shell.before}\n${body}\n${shell.after}`
}

/**
 * Move a formula to a different environment, keeping its body.
 *
 * Switching *into* a numbered environment when the body has no rows, or out
 * of one, is the whole point — "make this equation unnumbered" should be one
 * click, not an edit in two places that must agree.
 */
export function switchEnvironment(
  shell: MathShell,
  choice: string,
  body: string
): { shell: MathShell; body: string } {
  const next = normalizeBodyForEnv(shell, choice, body)
  if (choice === '\\[') {
    return {
      shell: {
        ...shell,
        kind: 'bracket',
        env: '',
        starred: true,
        before: leadingWhitespace(shell.before) + '\\[',
        after: '\\]' + trailingWhitespace(shell.after)
      },
      body: next
    }
  }
  const starred = choice.endsWith('*')
  const name = starred ? choice.slice(0, -1) : choice
  return {
    shell: {
      ...shell,
      kind: 'env',
      env: name,
      starred,
      before: `${leadingWhitespace(shell.before)}\\begin{${choice}}`,
      after: `\\end{${choice}}${trailingWhitespace(shell.after)}`
    },
    body: next
  }
}

// `equation` holds one formula; `align` holds rows of `lhs &= rhs`. Moving
// between them without touching the body leaves either a stray `&` that
// `equation` can't parse, or an `align` with nothing to align on.
function normalizeBodyForEnv(shell: MathShell, choice: string, body: string): string {
  const target = choice === '\\[' ? 'equation*' : choice
  const targetGrid = GRID_ENVIRONMENTS.has(target.replace(/\*$/, ''))
  const sourceGrid = shell.kind === 'env' && GRID_ENVIRONMENTS.has(shell.env)
  if (targetGrid === sourceGrid) return body
  if (targetGrid) {
    // Into a grid: put an alignment point at the first relation so `align`
    // actually aligns, rather than rendering as one long centred line.
    if (/(?<!\\)&/.test(body)) return body
    return body.replace(RELATION, '$1&$2')
  }
  // Out of a grid: `&` is a syntax error in `equation`, and `\\` means
  // nothing there. Fold the rows into one line.
  return splitRows(body)
    .map((row) => splitCells(row).join(' ').replace(/\s+/g, ' ').trim())
    .filter((row) => row !== '')
    .join(' \\quad ')
}

/** Change (or clear) the lifted label. */
export function withLabelText(shell: MathShell, label: string): MathShell {
  const trimmed = label.trim()
  return { ...shell, label: trimmed === '' ? null : trimmed }
}

// Where an `align` should put its `&`. Ordered longest-first so `\leq`
// isn't matched as `\le` with a stray `q` left behind.
const RELATION =
  /(^|[^&])(\\(?:coloneqq|coloneq|leqslant|geqslant|subseteq|supseteq|propto|approx|simeq|equiv|neq|leq|geq|sim|le|ge|to|in)\b|[=<>])/

function leadingWhitespace(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? ''
}

function trailingWhitespace(text: string): string {
  return /\s*$/.exec(text)?.[0] ?? ''
}

function indentOf(body: string): string {
  for (const line of body.split('\n')) {
    const match = /^([ \t]+)\S/.exec(line)
    if (match) return match[1]
  }
  return '  '
}

// ── Labels ─────────────────────────────────────────────────────────────

const LABEL_RE = /\\label\{([^}]*)\}/g

/**
 * Lift a `\label` out of the body when doing so can't change the meaning.
 *
 * In `equation` the label's position is irrelevant, so pulling it into a
 * field is free. In a multi-row `align` each row can carry its own label and
 * *which row* it is on decides what the reference points at — so those stay
 * in the body where the author can see the association.
 */
function withLabel(shell: MathShell): MathShell {
  const matches = [...shell.body.matchAll(LABEL_RE)]
  if (matches.length !== 1) return shell
  if (splitRows(shell.body).length > 1) return shell

  const match = matches[0]
  const before = shell.body.slice(0, match.index)
  return {
    ...shell,
    label: match[1],
    labelPlacement: before.trim() === '' ? 'leading' : 'trailing',
    body: before + shell.body.slice(match.index + match[0].length)
  }
}

function reinsertLabel(shell: MathShell, presented: string): string {
  if (!shell.label) return presented
  const tag = `\\label{${shell.label}}`
  return shell.labelPlacement === 'leading' ? `${tag}\n${presented}` : `${presented} ${tag}`
}

// ── Grid structure ─────────────────────────────────────────────────────

interface Separator {
  index: number
  length: number
  kind: 'row' | 'cell'
}

/**
 * Positions of the `\\` and `&` that structure a body, skipping any that are
 * nested inside braces or inside another environment — a `\\` in a `cases`
 * block belongs to the `cases`, not to the `align` around it.
 */
function separators(body: string): Separator[] {
  const out: Separator[] = []
  let brace = 0
  let depth = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body.startsWith('\\begin', i)) {
        depth++
        i += 6
        continue
      }
      if (body.startsWith('\\end', i)) {
        depth--
        i += 4
        continue
      }
      if (body[i + 1] === '\\') {
        if (brace === 0 && depth === 0) {
          // A row break may carry an optional `[6pt]` spacing argument, which
          // is part of the separator rather than of the next row.
          let end = i + 2
          while (end < body.length && /[ \t]/.test(body[end])) end++
          if (body[end] === '[') {
            const close = body.indexOf(']', end)
            if (close !== -1) end = close + 1
          } else {
            end = i + 2
          }
          out.push({ index: i, length: end - i, kind: 'row' })
        }
        i += 2
        continue
      }
      // Any other escape: skip the backslash and the character it protects,
      // so `\&` and `\{` don't register as structure.
      i += 2
      continue
    }
    if (c === '{') brace++
    else if (c === '}') brace--
    else if (c === '&' && brace === 0 && depth === 0) {
      out.push({ index: i, length: 1, kind: 'cell' })
    }
    i++
  }
  return out
}

/** Split a body on its top-level `\\`. Always returns at least one row. */
export function splitRows(body: string): string[] {
  const rows: string[] = []
  let last = 0
  for (const sep of separators(body)) {
    if (sep.kind !== 'row') continue
    rows.push(body.slice(last, sep.index))
    last = sep.index + sep.length
  }
  rows.push(body.slice(last))
  return rows
}

/** Split a single row on its top-level `&`. */
export function splitCells(row: string): string[] {
  const cells: string[] = []
  let last = 0
  for (const sep of separators(row)) {
    if (sep.kind !== 'cell') continue
    cells.push(row.slice(last, sep.index))
    last = sep.index + sep.length
  }
  cells.push(row.slice(last))
  return cells
}

export interface CellSpan {
  from: number
  to: number
  row: number
  column: number
}

/** Every cell in the body, in reading order, as offsets into the body. */
export function cellSpans(body: string): CellSpan[] {
  const spans: CellSpan[] = []
  let start = 0
  let row = 0
  let column = 0
  for (const sep of separators(body)) {
    spans.push({ from: start, to: sep.index, row, column })
    start = sep.index + sep.length
    if (sep.kind === 'row') {
      row++
      column = 0
    } else {
      column++
    }
  }
  spans.push({ from: start, to: body.length, row, column })
  return spans
}

/**
 * The cell after (or before) the caret — what Tab should move to.
 *
 * Returns null at the last cell, which the caller reads as "there is nowhere
 * to go, so make somewhere": Tab at the end of a matrix adds a column, which
 * is what every spreadsheet and every table editor does.
 */
export function nextCell(body: string, caret: number, direction: 1 | -1): CellSpan | null {
  const spans = cellSpans(body)
  const current = spans.findIndex((span) => caret >= span.from && caret <= span.to)
  const index = (current === -1 ? 0 : current) + direction
  return spans[index] ?? null
}

/** Append an empty row with the same number of columns as the widest one. */
export function addRow(body: string): string {
  const columns = gridSize(body).columns
  const blank = Array.from({ length: columns }, () => '').join(' & ')
  const trimmed = body.replace(/\s+$/, '')
  // A body that already ends in `\\` has a trailing empty row; fill that one
  // rather than adding a second separator and an empty row between them.
  const separator = trimmed.endsWith('\\\\') ? '\n' : ' \\\\\n'
  return `${trimmed}${separator}${blank}`
}

/** Append an empty cell to every row, keeping the grid rectangular. */
export function addColumn(body: string): string {
  const rows = splitRows(body)
  const rebuilt = rows.map((row) => `${row.trimEnd()} & `)
  // Rejoin with the row separators the body already used, so a body written
  // one-row-per-line stays that way.
  const seps = separators(body).filter((s) => s.kind === 'row')
  let out = rebuilt[0]
  for (let i = 1; i < rebuilt.length; i++) {
    out += body.slice(seps[i - 1].index, seps[i - 1].index + seps[i - 1].length) + rebuilt[i]
  }
  return out
}

/** Rough grid shape, for deciding whether to offer row/column controls. */
export function gridSize(body: string): { rows: number; columns: number } {
  const rows = splitRows(body)
  return {
    rows: rows.length,
    columns: Math.max(...rows.map((row) => splitCells(row).length))
  }
}

/**
 * Whether the formula is grid-shaped — either because its environment is one
 * or because the body contains a matrix. Drives whether the editor shows
 * row/column buttons at all.
 */
export function isGridBody(shell: MathShell, body = shell.body): boolean {
  if (shell.kind === 'env' && GRID_ENVIRONMENTS.has(shell.env)) return true
  return /\\begin\{[a-zA-Z]*matrix\*?\}|\\begin\{(cases|array|aligned|split)\}/.test(body)
}

// ── Errors ─────────────────────────────────────────────────────────────

/**
 * The character offset KaTeX blames, pulled out of its message.
 *
 * KaTeX says things like `KaTeX parse error: Undefined control sequence:
 * \foo at position 12: …`. That number is the single most useful thing in
 * the message and the only part a reader can't work out for themselves, so
 * the editor uses it to put the caret on the offending token.
 */
export function errorOffset(message: string): number | null {
  const match = /at position (\d+)/.exec(message)
  if (!match) return null
  // KaTeX counts from 1 and points *at* the offending token.
  return Math.max(0, Number(match[1]) - 1)
}

/** The message with KaTeX's boilerplate prefix and source echo removed. */
export function tidyErrorMessage(message: string): string {
  return message
    .replace(/^KaTeX parse error:\s*/, '')
    .replace(/\s*at position \d+:[\s\S]*$/, '')
    .trim()
}
