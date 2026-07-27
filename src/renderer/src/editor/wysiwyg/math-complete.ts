// Macro completion for the formula editor.
//
// The slow part of writing maths in LaTeX isn't typing, it's recall: which
// of `\coloneqq` / `\coloneq` / `\definedas` your preamble actually defines,
// whether the arrow is `\rightarrow` or `\to`, how many arguments `\binom`
// takes. Completing on `\` turns all of that from a lookup into a glance.
//
// The catalogue below is the common core. The genuinely valuable entries are
// the ones this module doesn't know: `\norm`, `\inner`, `\E` and whatever
// else the current paper's preamble declared. Those arrive via `userMacros`,
// so the author's own notation completes alongside the built-ins.
//
// Pure string work, so the matching is testable without a browser.

export interface Completion {
  /** Display name, always including the leading backslash. */
  name: string
  /** Text to splice in, replacing the typed `\word`. */
  insert: string
  /** Caret offset within `insert` after the splice. */
  caret: number
  /** Renderable sample for the preview column. */
  preview: string
  /** Short right-hand note: what it is, or where it came from. */
  detail: string
  /** Paper macros sort above built-ins — they're the ones you'd forget. */
  fromPaper: boolean
}

interface Entry {
  name: string
  /** Defaults to the name; set when the macro takes arguments. */
  insert?: string
  /** Defaults to the name; set when the bare macro renders as nothing. */
  preview?: string
  detail: string
  /**
   * A multi-cell construction — a matrix, a piecewise definition, a system.
   * These are the entries worth surfacing on a plain word (see
   * `structureQuery`), because nobody remembers that a bracketed matrix is
   * spelled `bmatrix` and a braced one `Bmatrix`.
   */
  structure?: boolean
  /** Words that should find this entry besides its own name. */
  keywords?: string[]
}

// `$` marks where the caret goes; stripped before insertion.
const CATALOGUE: Entry[] = [
  // Greek
  { name: '\\alpha', detail: 'greek' },
  { name: '\\beta', detail: 'greek' },
  { name: '\\gamma', detail: 'greek' },
  { name: '\\Gamma', detail: 'greek' },
  { name: '\\delta', detail: 'greek' },
  { name: '\\Delta', detail: 'greek' },
  { name: '\\epsilon', detail: 'greek' },
  { name: '\\varepsilon', detail: 'greek' },
  { name: '\\zeta', detail: 'greek' },
  { name: '\\eta', detail: 'greek' },
  { name: '\\theta', detail: 'greek' },
  { name: '\\Theta', detail: 'greek' },
  { name: '\\kappa', detail: 'greek' },
  { name: '\\lambda', detail: 'greek' },
  { name: '\\Lambda', detail: 'greek' },
  { name: '\\mu', detail: 'greek' },
  { name: '\\nu', detail: 'greek' },
  { name: '\\xi', detail: 'greek' },
  { name: '\\pi', detail: 'greek' },
  { name: '\\Pi', detail: 'greek' },
  { name: '\\rho', detail: 'greek' },
  { name: '\\sigma', detail: 'greek' },
  { name: '\\Sigma', detail: 'greek' },
  { name: '\\tau', detail: 'greek' },
  { name: '\\phi', detail: 'greek' },
  { name: '\\varphi', detail: 'greek' },
  { name: '\\chi', detail: 'greek' },
  { name: '\\psi', detail: 'greek' },
  { name: '\\Psi', detail: 'greek' },
  { name: '\\omega', detail: 'greek' },
  { name: '\\Omega', detail: 'greek' },

  // Structures — the ones with arguments, where completion saves the most.
  { name: '\\frac', insert: '\\frac{$}{}', preview: '\\frac{a}{b}', detail: 'fraction' },
  { name: '\\dfrac', insert: '\\dfrac{$}{}', preview: '\\dfrac{a}{b}', detail: 'display fraction' },
  { name: '\\sqrt', insert: '\\sqrt{$}', preview: '\\sqrt{x}', detail: 'root' },
  { name: '\\binom', insert: '\\binom{$}{}', preview: '\\binom{n}{k}', detail: 'binomial' },
  { name: '\\sum', insert: '\\sum_{$}^{}', preview: '\\sum_{i=1}^{n}', detail: 'sum' },
  { name: '\\prod', insert: '\\prod_{$}^{}', preview: '\\prod_{i=1}^{n}', detail: 'product' },
  { name: '\\int', insert: '\\int_{$}^{}', preview: '\\int_a^b', detail: 'integral' },
  { name: '\\iint', preview: '\\iint', detail: 'double integral' },
  { name: '\\oint', detail: 'contour integral' },
  { name: '\\lim', insert: '\\lim_{$ \\to }', preview: '\\lim_{x \\to 0}', detail: 'limit' },
  { name: '\\sup', detail: 'supremum' },
  { name: '\\inf', detail: 'infimum' },
  { name: '\\max', detail: 'maximum' },
  { name: '\\min', detail: 'minimum' },
  { name: '\\argmin', insert: '\\operatorname{arg\\,min}', preview: '\\operatorname{arg\\,min}', detail: 'argmin' },
  { name: '\\argmax', insert: '\\operatorname{arg\\,max}', preview: '\\operatorname{arg\\,max}', detail: 'argmax' },
  { name: '\\text', insert: '\\text{$}', preview: '\\text{words}', detail: 'prose inside maths' },
  { name: '\\mathbb', insert: '\\mathbb{$}', preview: '\\mathbb{R}', detail: 'blackboard bold' },
  { name: '\\mathcal', insert: '\\mathcal{$}', preview: '\\mathcal{O}', detail: 'calligraphic' },
  { name: '\\mathbf', insert: '\\mathbf{$}', preview: '\\mathbf{x}', detail: 'bold' },
  { name: '\\mathrm', insert: '\\mathrm{$}', preview: '\\mathrm{d}', detail: 'upright' },
  { name: '\\hat', insert: '\\hat{$}', preview: '\\hat{x}', detail: 'hat' },
  { name: '\\bar', insert: '\\bar{$}', preview: '\\bar{x}', detail: 'bar' },
  { name: '\\tilde', insert: '\\tilde{$}', preview: '\\tilde{x}', detail: 'tilde' },
  { name: '\\vec', insert: '\\vec{$}', preview: '\\vec{v}', detail: 'vector' },
  { name: '\\left', insert: '\\left( $ \\right)', preview: '\\left( x \\right)', detail: 'sized delimiters' },

  // Operators and relations
  { name: '\\partial', detail: 'partial' },
  { name: '\\nabla', detail: 'nabla' },
  { name: '\\infty', detail: 'infinity' },
  { name: '\\cdot', detail: 'dot product' },
  { name: '\\cdots', detail: 'centred ellipsis' },
  { name: '\\ldots', detail: 'baseline ellipsis' },
  { name: '\\times', detail: 'times' },
  { name: '\\otimes', detail: 'tensor product' },
  { name: '\\pm', detail: 'plus-minus' },
  { name: '\\leq', detail: 'less or equal' },
  { name: '\\geq', detail: 'greater or equal' },
  { name: '\\ll', detail: 'much less' },
  { name: '\\gg', detail: 'much greater' },
  { name: '\\neq', detail: 'not equal' },
  { name: '\\approx', detail: 'approximately' },
  { name: '\\sim', detail: 'similar' },
  { name: '\\simeq', detail: 'asymptotically equal' },
  { name: '\\equiv', detail: 'equivalent' },
  { name: '\\propto', detail: 'proportional' },
  { name: '\\coloneqq', detail: 'is defined as' },
  { name: '\\in', detail: 'element of' },
  { name: '\\notin', detail: 'not an element of' },
  { name: '\\subset', detail: 'subset' },
  { name: '\\subseteq', detail: 'subset or equal' },
  { name: '\\cup', detail: 'union' },
  { name: '\\cap', detail: 'intersection' },
  { name: '\\forall', detail: 'for all' },
  { name: '\\exists', detail: 'there exists' },
  { name: '\\langle', insert: '\\langle $ \\rangle', preview: '\\langle x \\rangle', detail: 'angle brackets' },

  // Arrows
  { name: '\\to', detail: 'arrow' },
  { name: '\\mapsto', detail: 'maps to' },
  { name: '\\rightarrow', detail: 'arrow' },
  { name: '\\leftarrow', detail: 'arrow' },
  { name: '\\Rightarrow', detail: 'implies' },
  { name: '\\Leftrightarrow', detail: 'if and only if' },
  { name: '\\xrightarrow', insert: '\\xrightarrow{$}', preview: '\\xrightarrow{f}', detail: 'labelled arrow' },

  // Structure inside a formula
  { name: '\\begin', insert: '\\begin{$}\n\n\\end{}', preview: '\\text{environment}', detail: 'environment' },
  { name: '\\pmatrix', insert: '\\begin{pmatrix}\n  $ & \\\\\n   & \n\\end{pmatrix}', preview: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', detail: 'matrix ( )', structure: true, keywords: ['matrix', 'grid', 'table', 'array', 'parens'] },
  { name: '\\bmatrix', insert: '\\begin{bmatrix}\n  $ & \\\\\n   & \n\\end{bmatrix}', preview: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', detail: 'matrix [ ]', structure: true, keywords: ['matrix', 'grid', 'table', 'array', 'brackets'] },
  { name: '\\vmatrix', insert: '\\begin{vmatrix}\n  $ & \\\\\n   & \n\\end{vmatrix}', preview: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', detail: 'determinant | |', structure: true, keywords: ['matrix', 'determinant', 'det'] },
  { name: '\\Bmatrix', insert: '\\begin{Bmatrix}\n  $ & \\\\\n   & \n\\end{Bmatrix}', preview: '\\begin{Bmatrix} a & b \\\\ c & d \\end{Bmatrix}', detail: 'matrix { }', structure: true, keywords: ['matrix', 'braces', 'set'] },
  { name: '\\matrix', insert: '\\begin{matrix}\n  $ & \\\\\n   & \n\\end{matrix}', preview: '\\begin{matrix} a & b \\\\ c & d \\end{matrix}', detail: 'matrix, no delimiters', structure: true, keywords: ['matrix', 'grid', 'plain'] },
  { name: '\\cases', insert: '\\begin{cases}\n  $ & \\\\\n   & \n\\end{cases}', preview: '\\begin{cases} a & x > 0 \\\\ b & x \\le 0 \\end{cases}', detail: 'piecewise', structure: true, keywords: ['cases', 'piecewise', 'branch', 'if', 'system'] },
  { name: '\\aligned', insert: '\\begin{aligned}\n  $ &= \\\\\n   &= \n\\end{aligned}', preview: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', detail: 'aligned rows', structure: true, keywords: ['align', 'aligned', 'derivation', 'steps'] },
  { name: '\\array', insert: '\\begin{array}{cc}\n  $ & \\\\\n   & \n\\end{array}', preview: '\\begin{array}{cc} a & b \\\\ c & d \\end{array}', detail: 'array with column spec', structure: true, keywords: ['array', 'table', 'grid', 'columns'] },
  { name: '\\substack', insert: '\\substack{$ \\\\ }', preview: '\\sum_{\\substack{i < j}}', detail: 'stacked subscript', structure: true, keywords: ['stack', 'subscript', 'under'] },
  { name: '\\label', insert: '\\label{$}', preview: '\\text{label}', detail: 'anchor for \\ref' },
  { name: '\\quad', detail: 'wide space' },
  { name: '\\qquad', detail: 'wider space' },
  { name: '\\nonumber', preview: '\\text{no number}', detail: 'skip this line’s number' }
]

/**
 * The `\word` immediately before the caret, if there is one.
 *
 * Returns null when the caret isn't in a macro — after a space, mid-word, or
 * after `\\` (a row break, not the start of a name). Nothing else in the
 * editor should have to know how a macro name is spelled.
 */
export function completionQuery(
  value: string,
  caret: number
): { from: number; word: string } | null {
  let i = caret
  while (i > 0 && /[a-zA-Z]/.test(value[i - 1])) i--
  if (i === 0 || value[i - 1] !== '\\') return null
  // `\\` ends a row; `\\alpha` is a row break followed by the letters
  // "alpha", not a macro, so don't offer to complete it.
  if (i >= 2 && value[i - 2] === '\\') return null
  return { from: i - 1, word: value.slice(i - 1, caret) }
}

/** How many letters a bare word needs before it is treated as a search. */
const STRUCTURE_MIN = 3

/**
 * A plain word before the caret, for suggesting multi-cell structures.
 *
 * `\` completion only helps someone who already knows the construction is
 * spelled with a backslash and roughly how. Typing "matrix" or "piecewise" is
 * what people actually do first, so a bare word is also a query — but only
 * against the handful of structure entries, and only from three letters. Every
 * other word in a formula is a variable or an operator name, and popping a list
 * over those would fight the author on nearly every keystroke.
 */
export function structureQuery(
  value: string,
  caret: number
): { from: number; word: string } | null {
  let i = caret
  while (i > 0 && /[a-zA-Z]/.test(value[i - 1])) i--
  if (i > 0 && value[i - 1] === '\\') return null // that's a macro, not a word
  const word = value.slice(i, caret)
  if (word.length < STRUCTURE_MIN) return null
  return { from: i, word }
}

/** Structure entries matching a bare word, by name or by keyword. */
export function structuresFor(word: string, limit = COMPLETION_LIMIT): Completion[] {
  const query = word.toLowerCase()
  const scored: Array<{ completion: Completion; score: number }> = []
  for (const entry of CATALOGUE) {
    if (!entry.structure) continue
    const terms = [entry.name.slice(1).toLowerCase(), ...(entry.keywords ?? [])]
    let best = -1
    for (const term of terms) {
      if (term === query) best = Math.max(best, 100)
      else if (term.startsWith(query)) best = Math.max(best, 60 - term.length)
      else if (term.includes(query)) best = Math.max(best, 20 - term.length)
    }
    if (best < 0) continue
    scored.push({ completion: toCompletion(entry, false), score: best })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.completion.name.length - b.completion.name.length)
    .slice(0, limit)
    .map((s) => s.completion)
}

function toCompletion(entry: Entry, fromPaper: boolean): Completion {
  const raw = entry.insert ?? entry.name
  const marker = raw.indexOf('$')
  return {
    name: entry.name,
    insert: marker === -1 ? raw : raw.slice(0, marker) + raw.slice(marker + 1),
    caret: marker === -1 ? raw.length : marker,
    preview: entry.preview ?? entry.name,
    detail: entry.detail,
    fromPaper
  }
}

export const COMPLETION_LIMIT = 9

/**
 * Every macro in the catalogue, with what it inserts and what it is for.
 *
 * The formula editor ranks these itself (see `completionsFor`); the source
 * view hands them to CodeMirror, which does its own matching. Both want the
 * same list, and duplicating it is how the two views end up disagreeing about
 * whether this document can write `\coloneqq`.
 */
export function catalogueEntries(): Array<{
  name: string
  insert: string
  caret: number
  detail: string
}> {
  return CATALOGUE.map((entry) => {
    const completion = toCompletion(entry, false)
    return {
      name: completion.name,
      insert: completion.insert,
      caret: completion.caret,
      detail: completion.detail
    }
  })
}

/**
 * Rank completions for a typed `\word`.
 *
 * A bare `\` lists the paper's own macros first — at that point the author
 * has expressed no preference, and their notation is the shortest thing to
 * remind them of.
 */
export function completionsFor(
  word: string,
  userMacros: string[] = [],
  limit = COMPLETION_LIMIT
): Completion[] {
  const query = word.replace(/^\\/, '').toLowerCase()
  const seen = new Set<string>()
  const paper: Entry[] = []
  for (const name of userMacros) {
    const macro = name.startsWith('\\') ? name : `\\${name}`
    if (seen.has(macro)) continue
    seen.add(macro)
    paper.push({ name: macro, detail: 'from this paper', preview: `\\text{${macro}}` })
  }

  const scored: Array<{ completion: Completion; score: number }> = []
  const consider = (entry: Entry, fromPaper: boolean): void => {
    const bare = entry.name.slice(1).toLowerCase()
    let score: number
    if (query === '') score = 1
    else if (bare === query) score = 100
    else if (bare.startsWith(query)) score = 60 - bare.length
    else if (bare.includes(query)) score = 20 - bare.length
    else return
    scored.push({ completion: toCompletion(entry, fromPaper), score: score + (fromPaper ? 5 : 0) })
  }

  for (const entry of paper) consider(entry, true)
  for (const entry of CATALOGUE) {
    if (seen.has(entry.name)) continue
    consider(entry, false)
  }

  return scored
    .sort((a, b) => b.score - a.score || a.completion.name.length - b.completion.name.length)
    .slice(0, limit)
    .map((s) => s.completion)
}

/** Splice a completion into a value, returning the new value and caret. */
export function applyCompletion(
  value: string,
  from: number,
  to: number,
  completion: Completion
): { value: string; caret: number } {
  return {
    value: value.slice(0, from) + completion.insert + value.slice(to),
    caret: from + completion.caret
  }
}
