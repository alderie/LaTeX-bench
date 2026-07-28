// Macro and environment *signatures* for the LaTeX parser.
//
// unified-latex is a real LaTeX parser, but LaTeX isn't parseable without
// knowing each macro's signature: `\citep[see][p.~4]{key}` is only three
// arguments if something told the parser that `\citep` takes `o o m`.
// Without that, unified-latex hands back a bare `\citep` macro followed by
// loose `[`, `see`, `]`, … text nodes — which is why the editor used to emit
// `\citep{}key[see][p.~4]` on save, and why `repairSerializerDamage` exists.
//
// So instead of guessing downstream (look ahead for a `group` sibling, strip a
// leading `[…]` by hand, …), we tell the parser the signatures up front. The
// spec language is xparse's:
//
//   m       required argument (a group or a single token)
//   o       optional `[…]` argument
//   s       optional star
//   d<x><y> optional argument delimited by <x> … <y>
//
// Signatures declared here are the *lingua franca* of scientific LaTeX —
// amsmath, natbib/biblatex, cleveref, graphicx, hyperref, booktabs, subcaption.
// Anything a specific document declares itself is picked up by
// `signaturesFromPreamble` below.

import { ACCENT_MACRO_NAMES } from './text-symbols'

export interface MacroSignature {
  signature: string
}

// ── Accents ────────────────────────────────────────────────────────────
// All of these take exactly one argument, which may be braceless
// (`\'e`) or braced (`\'{e}`). Declaring them is what makes
// `Fran\c{c}ois` parse as one accented word instead of a `\c` macro
// followed by the loose text `cois` — the shape that used to serialize
// back out as the undefined macro `\ccois`. The names themselves live in
// text-symbols.ts alongside the combining marks they map to.

const TEXT_MACROS_WITH_ONE_ARG = [
  // Font/shape switches with an argument.
  'textbf',
  'textit',
  'texttt',
  'textsc',
  'textsf',
  'textrm',
  'textnormal',
  'textsl',
  'textup',
  'textmd',
  'emph',
  'underline',
  'uline',
  'mbox',
  'hbox',
  'fbox',
  'framebox',
  'textsuperscript',
  'textsubscript',
  'enquote',
  'lowercase',
  'uppercase',
  'MakeLowercase',
  'MakeUppercase',
  // Structure / metadata.
  'title',
  'author',
  'date',
  'subtitle',
  'label',
  'caption*',
  'bibliographystyle',
  'bibliography',
  'nocite',
  'printbibliography',
  'input',
  'include',
  'subfile',
  'url',
  'nolinkurl',
  'path',
  'newtheoremstyle',
  'theoremstyle',
  'ensuremath',
  'text',
  'mathrm',
  'mathbf',
  'mathit',
  'mathcal',
  'mathbb',
  'mathfrak',
  'mathsf',
  'mathtt',
  'boldsymbol',
  'operatorname',
  'vspace',
  'pagestyle',
  'thispagestyle',
  'phantom',
  'hphantom',
  'vphantom'
]

// Citation commands. natbib and biblatex both allow two optional notes
// before the key list: `\citep[see][p.~4]{key}`.
export const CITE_MACRO_NAMES = [
  'cite',
  'citep',
  'citet',
  'Citep',
  'Citet',
  'citealp',
  'citealt',
  'Citealp',
  'Citealt',
  'citeauthor',
  'Citeauthor',
  'citeyear',
  'citeyearpar',
  'parencite',
  'Parencite',
  'textcite',
  'Textcite',
  'autocite',
  'Autocite',
  'footcite',
  'footcitetext',
  'citenum',
  'citetitle',
  'fullcite',
  'supercite'
]

// Cross-reference commands. cleveref's `\cref` takes a comma-separated key
// list; `\crefrange` takes two keys.
const REF_MACROS_ONE_KEY = [
  'ref',
  'eqref',
  'autoref',
  'cref',
  'Cref',
  'cpageref',
  'Cpageref',
  'pageref',
  'nameref',
  'vref',
  'labelcref',
  'namecref',
  'autopageref'
]
const REF_MACROS_TWO_KEYS = ['crefrange', 'Crefrange', 'cpagerefrange']

export const MACRO_SIGNATURES: Record<string, MacroSignature> = {}

for (const name of ACCENT_MACRO_NAMES) MACRO_SIGNATURES[name] = { signature: 'm' }
for (const name of TEXT_MACROS_WITH_ONE_ARG) MACRO_SIGNATURES[name] = { signature: 'm' }
for (const name of CITE_MACRO_NAMES) MACRO_SIGNATURES[name] = { signature: 'o o m' }
for (const name of REF_MACROS_ONE_KEY) MACRO_SIGNATURES[name] = { signature: 'm' }
for (const name of REF_MACROS_TWO_KEYS) MACRO_SIGNATURES[name] = { signature: 'm m' }

Object.assign(MACRO_SIGNATURES, {
  // graphicx / floats.
  includegraphics: { signature: 'o o m' },
  caption: { signature: 'o m' },
  subcaption: { signature: 'o m' },
  // hyperref.
  href: { signature: 'o m m' },
  hyperref: { signature: 'o m' },
  texorpdfstring: { signature: 'm m' },
  // xcolor.
  textcolor: { signature: 'o m m' },
  colorbox: { signature: 'o m m' },
  fcolorbox: { signature: 'o m m m' },
  // Footnotes.
  footnote: { signature: 'o m' },
  footnotetext: { signature: 'o m' },
  footnotemark: { signature: 'o' },
  thanks: { signature: 'm' },
  // Tabular material — needed so `\multicolumn{3}{c}{Benchmark}` doesn't
  // leak its arguments into the surrounding cell text.
  multicolumn: { signature: 'm m m' },
  multirow: { signature: 'o m o m m' },
  cmidrule: { signature: 'd() m' },
  cline: { signature: 'm' },
  // amsmath / amsthm.
  DeclareMathOperator: { signature: 's m m' },
  newtheorem: { signature: 's m o m o' },
  tag: { signature: 's m' },
  // Lengths and spacing.
  setlength: { signature: 'm m' },
  addtolength: { signature: 'm m' },
  hspace: { signature: 's m' },
  rule: { signature: 'o m m' },
  // Misc structure.
  usepackage: { signature: 'o m' },
  documentclass: { signature: 'o m' },
  newcolumntype: { signature: 'm o m' },
  resizebox: { signature: 'm m m' },
  scalebox: { signature: 'm o m' }
} satisfies Record<string, MacroSignature>)

// ── Environments ───────────────────────────────────────────────────────
// Environment arguments matter just as much: `\begin{subfigure}[b]{0.45\linewidth}`
// used to drop the width and render the literal text "0.45\linewidth" as the
// first paragraph of the subfigure.
//
// Theorem-like environments take an optional `[title]`; declaring it here is
// what lets `\begin{theorem}[Convergence rate]` keep its title instead of
// silently losing it.
const THEOREM_LIKE = [
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'assumption',
  'conjecture',
  'remark',
  'example',
  'observation',
  'fact',
  'claim',
  'note',
  'proof',
  'problem',
  'exercise',
  'solution',
  'question',
  'axiom',
  'property'
]

// Floats and float-ish wrappers: `[placement]` only.
const PLACEMENT_ONLY = [
  'figure',
  'figure*',
  'table',
  'table*',
  'algorithm',
  'algorithm*',
  'listing',
  'listing*',
  'sidewaystable',
  'sidewaysfigure',
  'lstlisting',
  'Verbatim',
  'BVerbatim',
  'LVerbatim',
  'itemize',
  'enumerate',
  'description',
  'tcolorbox',
  'quoting'
]

export const ENVIRONMENT_SIGNATURES: Record<string, MacroSignature> = {}

for (const name of THEOREM_LIKE) ENVIRONMENT_SIGNATURES[name] = { signature: 'o' }
for (const name of PLACEMENT_ONLY) ENVIRONMENT_SIGNATURES[name] = { signature: 'o' }

Object.assign(ENVIRONMENT_SIGNATURES, {
  subfigure: { signature: 'o m' },
  subtable: { signature: 'o m' },
  minipage: { signature: 'o o m' },
  wrapfigure: { signature: 'o m m' },
  wraptable: { signature: 'o m m' },
  tabular: { signature: 'o m' },
  'tabular*': { signature: 'm o m' },
  tabularx: { signature: 'm o m' },
  longtable: { signature: 'o m' },
  array: { signature: 'o m' },
  multicols: { signature: 'm o' },
  alignat: { signature: 'm' },
  'alignat*': { signature: 'm' },
  thebibliography: { signature: 'm' }
} satisfies Record<string, MacroSignature>)

// ── Document-declared macros ───────────────────────────────────────────

// `\newcommand{\todo}[2][red]{…}` declares a macro with signature `o m`.
// Reading the document's own definitions means a paper's private macros get
// the same treatment as the standard library — without them, `\todo[blue]{fix}`
// leaks `[blue]` as literal text.
//
// This runs on raw source rather than the AST because the signatures have to
// exist *before* the parse that would produce that AST.
const DECL_RE =
  /\\(?:new|renew|provide)command\s*\*?\s*(?:\{\s*\\([A-Za-z@]+)\s*\}|\\([A-Za-z@]+))\s*(?:\[(\d+)\])?\s*(\[)?/g

/**
 * Everything before `\begin{document}`, with comments blanked out.
 *
 * Both halves matter, and both were wrong. A preamble comment that merely
 * *mentions* `\begin{document}` — "% put your macros before \begin{document}"
 * is advice people actually write — used to end the preamble right there, so
 * every macro defined below it was invisible and every use of one was parsed
 * as a bare macro plus loose groups. And a commented-out `\newcommand`
 * registered a signature for a macro that does not exist.
 *
 * Offsets are preserved rather than removed so the returned string still
 * lines up with the source, which keeps this cheap to reason about.
 */
export function preambleForSignatures(source: string): string {
  let out = ''
  let inComment = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\n') {
      inComment = false
      out += c
      continue
    }
    if (!inComment && c === '%') {
      let backslashes = 0
      for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) backslashes++
      if (backslashes % 2 === 0) inComment = true
    }
    out += inComment ? ' ' : c
  }
  const docStart = out.indexOf('\\begin{document}')
  return docStart >= 0 ? out.slice(0, docStart) : out
}

export function signaturesFromPreamble(source: string): Record<string, MacroSignature> {
  const out: Record<string, MacroSignature> = {}
  // Only look at the preamble: definitions after \begin{document} are rare,
  // and scanning the whole body would pick up `\newcommand` inside verbatim.
  const preamble = preambleForSignatures(source)

  DECL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DECL_RE.exec(preamble)) !== null) {
    const name = m[1] ?? m[2]
    if (!name) continue
    const argCount = m[3] ? parseInt(m[3], 10) : 0
    if (!Number.isFinite(argCount) || argCount < 0 || argCount > 9) continue
    // A `[` immediately after `[n]` is the default value for the first
    // argument, which makes that argument optional.
    const firstIsOptional = Boolean(m[4])
    if (argCount === 0) continue
    const parts: string[] = []
    for (let i = 0; i < argCount; i++) {
      parts.push(i === 0 && firstIsOptional ? 'o' : 'm')
    }
    // Never let a document's definition shadow a standard signature — a
    // paper redefining `\cite` still wants natbib's argument shape.
    if (MACRO_SIGNATURES[name]) continue
    out[name] = { signature: parts.join(' ') }
  }
  return out
}

/** The full macro table for a given document. */
export function macroSignaturesFor(source: string): Record<string, MacroSignature> {
  return { ...MACRO_SIGNATURES, ...signaturesFromPreamble(source) }
}
