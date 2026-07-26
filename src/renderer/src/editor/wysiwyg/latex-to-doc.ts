import { Node as PMNode } from 'prosemirror-model'
import { latexSchema } from './schema'

// Lazy-import @unified-latex/* — they are ESM-only and bulky.
type AstNode = any
type AstNodeArr = AstNode[]

let parseModulePromise: Promise<typeof import('@unified-latex/unified-latex-util-parse')> | null = null
let printModulePromise: Promise<typeof import('@unified-latex/unified-latex-util-print-raw')> | null = null

async function loadParseModule(): Promise<typeof import('@unified-latex/unified-latex-util-parse')> {
  if (!parseModulePromise) {
    parseModulePromise = import('@unified-latex/unified-latex-util-parse')
  }
  return parseModulePromise
}

export async function loadPrintModule(): Promise<typeof import('@unified-latex/unified-latex-util-print-raw')> {
  if (!printModulePromise) {
    printModulePromise = import('@unified-latex/unified-latex-util-print-raw')
  }
  return printModulePromise
}

const SECTION_MACROS: Record<string, number> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
  // Run-in headings. LaTeX numbers them too (they just aren't shown by
  // default in `article`), and treating them as text — which is what
  // happened before — merged the heading into the following paragraph.
  paragraph: 4,
  subparagraph: 5
}

// ── Source-text access ──────────────────────────────────────────────────
// unified-latex records byte offsets on every node. Reconstructing raw
// LaTeX with `printRaw` collapses runs of whitespace into a single space
// and drops environment arguments, which silently rewrites the user's
// file on every save. Slicing the original source instead is byte-exact.
//
// Everything after `parse()` inside `parseLatexToDoc` runs synchronously,
// so a module-level handle is safe here and saves threading a context
// object through every helper.
let sourceText = ''

// Offset just past the balanced `{…}` / `[…]` group starting at `from`,
// or null if there isn't one there.
function balancedEnd(from: number, open: string, close: string): number | null {
  if (sourceText[from] !== open) return null
  let depth = 0
  for (let i = from; i < sourceText.length; i++) {
    const c = sourceText[i]
    if (c === '\\') {
      i++ // an escaped brace is not a delimiter
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return null
}

function spanOf(node: any): [number, number] | null {
  const start = node?.position?.start?.offset
  let end = node?.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return null
  // A macro's `position` covers only the macro name, and unified-latex
  // doesn't record positions on `argument` nodes — so walk the source
  // forward over exactly as many delimited arguments as the macro has.
  // (Environments already span `\begin`…`\end`, so they're left alone.)
  if (node.type === 'macro') {
    let cursor = end
    for (const arg of node.args ?? []) {
      if (arg?.openMark !== '{' && arg?.openMark !== '[') continue
      let k = cursor
      while (k < sourceText.length && /\s/.test(sourceText[k])) k++
      const argEnd = balancedEnd(k, arg.openMark, arg.closeMark ?? (arg.openMark === '{' ? '}' : ']'))
      if (argEnd === null) break
      cursor = argEnd
    }
    end = cursor
  }
  if (end < start || end > sourceText.length) return null
  return [start, end]
}

// Byte-exact source for a node, falling back to printRaw when the node
// was synthesised (or positions are missing).
function rawOf(node: any, printRaw: (n: AstNodeArr) => string): string {
  const span = spanOf(node)
  if (span) return sourceText.slice(span[0], span[1])
  return printRaw([node])
}

// Byte-exact source spanning a run of sibling nodes.
function rawOfRange(nodes: AstNodeArr, printRaw: (n: AstNodeArr) => string): string {
  if (nodes.length === 0) return ''
  const first = spanOf(nodes[0])
  const last = spanOf(nodes[nodes.length - 1])
  if (first && last && last[1] >= first[0]) return sourceText.slice(first[0], last[1])
  return printRaw(nodes)
}

const MATH_BLOCK_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'displaymath',
  'gather',
  'gather*',
  'multline',
  'multline*'
])

const FIGURE_ENVS = new Set(['figure', 'figure*'])
const LIST_ENVS = new Set(['itemize', 'enumerate', 'description'])

// Float environments that carry a `\caption` + `\label` and arbitrary
// block content. Parsed into a `floatBlock` so the body survives editing
// and the label lands in the cross-reference registry.
const FLOAT_ENVS = new Set([
  'table',
  'table*',
  'algorithm',
  'algorithm*',
  'listing',
  'listing*',
  'wrapfigure',
  'wraptable',
  'subfigure',
  'sidewaystable',
  'sidewaysfigure'
])

// Verbatim-ish code environments. Their bodies must never be re-parsed as
// LaTeX — unified-latex already hands them to us as a single opaque string
// (or a `verbatim` node), and we keep them byte-exact.
const CODE_ENVS = new Set([
  'verbatim',
  'verbatim*',
  'lstlisting',
  'minted',
  'alltt',
  'Verbatim',
  'BVerbatim',
  'LVerbatim',
  'semiverbatim',
  'lstinputlisting'
])

// amsthm-style theorem-like envs. These are user-declared via \newtheorem
// in a real document, but we hardcode the common names so the WYSIWYG view
// surfaces them as first-class callouts. Bodies are recursed as block
// content. Optional `[title]` is captured.
const THEOREM_ENVS = new Set([
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
  'proof'
])

const BIBLIOGRAPHY_ENVS = new Set(['thebibliography'])

// Container environments that are layout-only — they hold ordinary block
// content (paragraphs, math, tables) rather than text the way `equation`
// or `figure` do. We recurse into their body and emit each child as a
// regular block, so e.g. `\begin{table}\begin{align*}…\end{align*}\end{table}`
// surfaces the math inside instead of being one opaque rawLatex blob.
const CONTAINER_ENVS = new Set([
  'table',
  'table*',
  'minipage',
  'center',
  'flushleft',
  'flushright',
  'quote',
  'quotation',
  'abstract',
  'titlepage',
  'samepage',
  'sloppypar'
])

// Macros that should be rendered as standalone block-level elements rather
// than swallowed into a paragraph. Anything here gets its own rawLatex
// node so the verbatim source survives a WYSIWYG round-trip.
const BLOCK_MACROS = new Set([
  // standard article
  'maketitle',
  'tableofcontents',
  'listoffigures',
  'listoftables',
  'newpage',
  'clearpage',
  'pagebreak',
  'bibliography',
  'bibliographystyle',
  'printbibliography',
  'appendix',
  'input',
  'include',
  // moderncv structural macros
  'makecvtitle',
  'makecvfooter',
  'makelettertitle',
  'makeletterclosing',
  'makeletterfooter',
  'cventry',
  'cvitem',
  'cvitemwithcomment',
  'cvline',
  'cvdoublecolumn',
  'cvlistitem',
  'cvlistdoubleitem',
  'cvlanguage',
  'cvcomputer',
  'cvreference',
  'closesection',
  // article-class metadata macros — meaningless in body without
  // \maketitle, and consecutive ones should each become their own
  // standalone block so they don't bleed into a paragraph together.
  'title',
  'author',
  'date',
  'subtitle',
  // bibliography helpers
  'nocite',
  'newbibliography',
  // misc spacing/structural
  'vfill',
  'medskip',
  'bigskip',
  'smallskip'
])

// Inline macros that wrap content and should recurse into their last
// required argument with no special mark. Used for typography styles
// we don't model in the schema; the visible text still appears.
const TRANSPARENT_INLINE_WRAPPERS = new Set([
  'textsf',
  'textrm',
  'textnormal',
  'mbox',
  'underline'
])

// Inline macros with no required arguments — typographic icons, special
// glyphs, spacing macros. Mapped to a Unicode glyph (or empty for spacing)
// so the WYSIWYG view shows something sensible. Round-trip through source
// goes through the rawInline node so the macro name is preserved.
const ICON_MACRO_GLYPHS: Record<string, string> = {
  // marvosym
  Letter: '✉',
  Telefon: '☎',
  Mobilefone: '📱',
  Email: '✉',
  Globe: '🌐',
  // fontawesome
  faGithub: '\u{f09b}',
  faLinkedin: '\u{f08c}',
  faSkype: '\u{f17e}',
  faStackExchange: '\u{f18d}',
  faStackOverflow: '\u{f16c}',
  faTwitter: '\u{f099}',
  faOrcid: '\u{f8d2}',
  faEnvelope: '✉',
  faGlobe: '🌐',
  faPhone: '☎',
  // moderncv address symbols
  emailsymbol: '✉',
  phonesymbol: '☎',
  homepagesymbol: '🌐',
  addresssymbol: '📍',
  // unicode-ish text
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  textbar: '|',
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
  copyright: '©',
  registered: '®',
  texttrademark: '™',
  ' ': ' ',
  S: '§',
  P: '¶'
}

// Macros that emit whitespace only.
const SPACE_MACROS = new Set([
  'quad',
  'qquad',
  ',',
  ';',
  ':',
  '!',
  ' ',
  'thinspace',
  'medspace',
  'thickspace',
  'enspace',
  'hspace',
  'hfill',
  'vfill',
  'newline',
  '\\'
])

// Layout-only macros — emit no visible output and shouldn't leak as text.
// These are control macros that affect surrounding context (alignment,
// page breaks, font-changes-for-rest-of-block) which we can't model in
// the WYSIWYG schema. They round-trip via the rawLatex/source escape
// hatch when the user toggles to Source mode.
const SILENT_MACROS = new Set([
  'centering',
  'raggedleft',
  'raggedright',
  'raggedbottom',
  'flushbottom',
  'noindent',
  'indent',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
  'tiny',
  'scriptsize',
  'footnotesize',
  'sloppy',
  'fussy',
  'allowdisplaybreaks',
  // bibtex paragraph separators inside \bibitem entries — visually a
  // soft space, not a line break. Drop them so the entry reads cleanly.
  'newblock'
])

// Inline macros we explicitly handle. Used by the block-level heuristic so
// that e.g. `\textbf{Hello}` at the start of a paragraph is recognized as
// an inline mark, not a structural block macro.
const KNOWN_INLINE_MACROS = new Set<string>([
  'cite',
  'ref',
  'eqref',
  'autoref',
  'textbf',
  'textit',
  'emph',
  'texttt',
  'textsc',
  'href',
  'url',
  'label',
  'footnote',
  'thanks',
  'footnotemark',
  ...TRANSPARENT_INLINE_WRAPPERS,
  ...Object.keys(ICON_MACRO_GLYPHS),
  ...SPACE_MACROS,
  ...SILENT_MACROS
])

function hasRequiredArg(macro: any): boolean {
  const args = macro.args ?? []
  return args.some((a: any) => a.openMark === '{')
}

// True when nothing buffered for the current paragraph would render —
// whitespace, comments, and layout-only macros like `\small`/`\noindent`.
// Used to decide whether a macro sits at "block position".
function isBlankAstBuffer(buf: AstNodeArr): boolean {
  for (const n of buf) {
    if (n.type === 'whitespace' || n.type === 'comment' || n.type === 'parbreak') continue
    if (n.type === 'macro' && SILENT_MACROS.has(n.content as string)) continue
    if (n.type === 'string' && String(n.content ?? '').trim().length === 0) continue
    return false
  }
  return true
}

// Heuristic: does a group's body contain anything we'd treat as block-level?
// Used to decide whether `{ ... }` at top-level should be unwrapped into
// blocks (e.g. `{\small \enumsentence{...}}`) vs. rendered as inline text
// (e.g. a stray `{some text}` group inside a paragraph).
function groupContainsBlockContent(nodes: any[]): boolean {
  for (const n of nodes) {
    if (n.type === 'environment' || n.type === 'mathenv' || n.type === 'displaymath') return true
    if (n.type === 'parbreak') return true
    if (n.type === 'macro') {
      const name = n.content as string
      if (SECTION_MACROS[name]) return true
      if (BLOCK_MACROS.has(name)) return true
      // Unknown macro that has either captured args or is followed by a
      // group — likely a structural macro like \enumsentence{...}.
      if ((n.args ?? []).some((a: any) => a.openMark === '{')) return true
    }
    if (n.type === 'group') {
      // Recurse — nested `{{...}}` is rare but should propagate.
      if (groupContainsBlockContent(n.content ?? [])) return true
    }
  }
  // Last resort: scan for a macro followed by a group sibling.
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type === 'macro') {
      for (let j = i + 1; j < nodes.length; j++) {
        const next = nodes[j]
        if (next.type === 'whitespace' || next.type === 'comment') continue
        if (next.type === 'group') return true
        break
      }
    }
  }
  return false
}

export interface ParseResult {
  doc: PMNode
  preamble: string
  documentClass: string
  // KaTeX-compatible macro map distilled from \newcommand /
  // \renewcommand / \providecommand / \DeclareMathOperator in the
  // preamble. Pass into katex.render({ macros }).
  mathMacros: Record<string, string>
}

// Macros that take a single brace-delimited key list. Used by the repair
// pass below.
const KEY_LIST_MACROS =
  'cite|citep|citet|Citep|Citet|citealp|citealt|citeauthor|citeyear|citeyearpar|' +
  'parencite|Parencite|textcite|Textcite|autocite|footcite|citenum|' +
  'ref|eqref|autoref|cref|Cref|pageref|nameref|vref|labelcref|label'

// Undo damage earlier versions of this editor wrote to .tex files.
//
// When a `\citep{a,b}` failed to parse, the citation node ended up with no
// keys and the `{a,b}` group leaked into the surrounding text. Serializing
// that back out produced `\cite{}a,b` — an empty argument followed by the
// keys as bare prose, which is why affected papers render `[?]` followed by
// their own cite keys. `\macro{}` immediately butted against a key-shaped
// run is never something a person writes, so folding it back in is safe.
export function repairSerializerDamage(tex: string): string {
  const re = new RegExp(
    `\\\\(${KEY_LIST_MACROS})\\{\\}([A-Za-z0-9_:.+-]+(?:\\s*,\\s*[A-Za-z0-9_:.+-]+)*)`,
    'g'
  )
  return tex.replace(re, (_match, macro: string, keys: string) => {
    // A trailing period is sentence punctuation, not part of a cite key.
    const trailing = /\.+$/.exec(keys)?.[0] ?? ''
    const cleaned = trailing ? keys.slice(0, -trailing.length) : keys
    if (!cleaned) return `\\${macro}{}${keys}`
    return `\\${macro}{${cleaned.replace(/\s*,\s*/g, ',')}}${trailing}`
  })
}

export async function parseLatexToDoc(input: string): Promise<ParseResult> {
  const { parse } = await loadParseModule()
  const { printRaw } = await loadPrintModule()

  const tex = repairSerializerDamage(input)
  sourceText = tex
  const ast = parse(tex)
  const root = ast.content as AstNodeArr

  // Locate \begin{document}…\end{document}; everything before is preamble.
  let docStart = -1
  for (let i = 0; i < root.length; i++) {
    const n = root[i]
    if (n.type === 'environment' && (n.env === 'document' || n.env === 'document*')) {
      docStart = i
      break
    }
  }

  const preambleNodes: AstNodeArr = docStart >= 0 ? root.slice(0, docStart) : []
  const bodyNodes: AstNodeArr =
    docStart >= 0 ? (root[docStart] as any).content : root // fall back to entire input

  const documentClass = extractDocumentClass(preambleNodes)
  const mathMacros = extractMathMacros(preambleNodes, printRaw)

  // Only extract \title/\author/\date when the body actually has
  // \maketitle to anchor them. Otherwise the metadata stays inside the
  // preamble source string, untouched, and round-trips byte-for-byte.
  const hasMaketitle = bodyHasMaketitle(bodyNodes)
  const { titleMetadata, cleanedPreambleNodes, removedSpans } = hasMaketitle
    ? extractTitleMetadata(preambleNodes, printRaw)
    : {
        titleMetadata: undefined,
        cleanedPreambleNodes: preambleNodes,
        removedSpans: [] as Array<[number, number]>
      }

  // Prefer the original bytes for the preamble. printRaw normalises
  // whitespace, so round-tripping through it reflowed `\usepackage` lines
  // onto one line and doubled blank lines a little more on every save.
  const docNodeStart = docStart >= 0 ? (root[docStart] as any)?.position?.start?.offset : undefined
  const preambleText =
    typeof docNodeStart === 'number'
      ? cutSpans(tex.slice(0, docNodeStart), removedSpans).replace(/\s+$/, '')
      : printRaw(cleanedPreambleNodes).trim()

  const blocks = nodesToBlocks(bodyNodes, printRaw, titleMetadata)

  // Build the PM doc. Top-level always starts with a hidden preamble node so
  // the round-trip can reattach it on serialize.
  const docContent: PMNode[] = [
    latexSchema.nodes.preamble.create({ source: preambleText })
  ]
  if (blocks.length === 0) {
    docContent.push(latexSchema.nodes.paragraph.create())
  } else {
    docContent.push(...blocks)
  }

  return {
    doc: latexSchema.nodes.doc.create({}, docContent),
    preamble: preambleText,
    documentClass,
    mathMacros
  }
}

function bodyHasMaketitle(body: AstNodeArr): boolean {
  for (const n of body) {
    if (n.type === 'macro' && n.content === 'maketitle') return true
  }
  return false
}

// ── Title metadata extraction ──────────────────────────────────────────

interface TitleMetadata {
  titleNodes: AstNodeArr
  authorEntries: AstNodeArr[] // split on \and
  dateNodes: AstNodeArr | null
  dateKind: 'today' | 'literal'
  hasAny: boolean
}

// Remove a set of [start, end) source spans from `text`, leaving the rest
// byte-exact. Spans are sorted and merged so overlaps are harmless.
function cutSpans(text: string, spans: Array<[number, number]>): string {
  if (spans.length === 0) return text
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let out = ''
  let cursor = 0
  for (const [start, end] of sorted) {
    if (end <= cursor) continue
    if (start > cursor) out += text.slice(cursor, Math.min(start, text.length))
    cursor = Math.max(cursor, end)
  }
  out += text.slice(cursor)
  return out
}

function extractTitleMetadata(
  preamble: AstNodeArr,
  printRaw: (n: AstNodeArr) => string
): {
  titleMetadata: TitleMetadata
  cleanedPreambleNodes: AstNodeArr
  removedSpans: Array<[number, number]>
} {
  const meta: TitleMetadata = {
    titleNodes: [],
    authorEntries: [],
    dateNodes: null,
    dateKind: 'literal',
    hasAny: false
  }
  const cleaned: AstNodeArr = []
  const removedSpans: Array<[number, number]> = []
  const drop = (n: any): void => {
    const span = spanOf(n)
    if (span) removedSpans.push(span)
  }
  for (const n of preamble) {
    if (n.type === 'macro' && n.content === 'title') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      meta.titleNodes = arg?.content ?? []
      meta.hasAny = true
      drop(n)
      continue
    }
    if (n.type === 'macro' && n.content === 'author') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      const content: AstNodeArr = arg?.content ?? []
      meta.authorEntries = splitOnAnd(content)
      meta.hasAny = true
      drop(n)
      continue
    }
    if (n.type === 'macro' && n.content === 'date') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      const content: AstNodeArr = arg?.content ?? []
      // Detect `\today` so we can re-emit it on serialize without baking
      // a frozen date into the source.
      const onlyToday =
        content.length === 1 &&
        content[0].type === 'macro' &&
        content[0].content === 'today'
      meta.dateNodes = content
      meta.dateKind = onlyToday ? 'today' : 'literal'
      meta.hasAny = true
      // Suppress today's literal text — date is rendered live in the view.
      void printRaw
      drop(n)
      continue
    }
    cleaned.push(n)
  }
  return { titleMetadata: meta, cleanedPreambleNodes: cleaned, removedSpans }
}

function splitOnAnd(content: AstNodeArr): AstNodeArr[] {
  const groups: AstNodeArr[] = []
  let current: AstNodeArr = []
  for (const n of content) {
    if (n.type === 'macro' && n.content === 'and') {
      groups.push(current)
      current = []
      continue
    }
    current.push(n)
  }
  groups.push(current)
  return groups
}

// Walk preamble nodes and pick out macro definitions usable by KaTeX.
// Supported declarators:
//   \newcommand{\name}[n][optdefault]{body}
//   \renewcommand{\name}[n]{body}
//   \providecommand{\name}[n]{body}
//   \DeclareMathOperator{\name}{body}      → \\operatorname{body}
//   \DeclareMathOperator*{\name}{body}     → \\operatorname*{body}
// Anything we can't confidently parse is silently skipped — KaTeX will
// then render the unknown macro in its default (red) error style, which
// is the right signal to the user that the macro wasn't picked up.
function extractMathMacros(
  preamble: AstNodeArr,
  printRaw: (n: AstNodeArr) => string
): Record<string, string> {
  // Only what the preamble actually declares. `\label`/`\nonumber`/`\notag`
  // are handled by MathNodeView's built-in macro table — seeding them here
  // as `''` overrode its `\label` definition (which consumes the `{key}`
  // argument), so equation labels rendered as visible math: "eq:upper".
  const macros: Record<string, string> = {}

  const macroNameOf = (arg: any): string | null => {
    if (!arg) return null
    const content = arg.content as AstNodeArr
    if (!content || content.length === 0) return null
    // Inside `{\name}` the macro arrives as a single node of type=macro.
    // unified-latex represents `\name` as `{ type: 'macro', content: 'name' }`.
    const first = content.find(
      (c: any) => c.type !== 'whitespace' && c.type !== 'comment'
    )
    if (!first) return null
    if (first.type === 'macro' && typeof first.content === 'string') {
      return `\\${first.content}`
    }
    // Some preambles write `{name}` without backslash (rare). Skip those —
    // they aren't valid \newcommand syntax.
    return null
  }

  const numericArg = (arg: any): number | null => {
    if (!arg) return null
    const text = printRaw(arg.content as AstNodeArr).trim()
    const n = parseInt(text, 10)
    return Number.isFinite(n) ? n : null
  }

  // Track the previous non-whitespace node so we can detect `\Macro*` (the
  // star is a separate `string` node in unified-latex's AST, not part of
  // the macro name).
  let starredHere = false
  for (let idx = 0; idx < preamble.length; idx++) {
    const n = preamble[idx]
    if (n.type === 'whitespace' || n.type === 'comment') continue
    if (n.type !== 'macro') continue
    const name = n.content as string
    const args = (n.args ?? []) as Array<{ openMark: string; content: AstNodeArr }>

    // Look ahead one non-whitespace token: a `*` immediately after the macro
    // means the starred variant.
    starredHere = false
    for (let j = idx + 1; j < preamble.length; j++) {
      const t = preamble[j]
      if (t.type === 'whitespace' || t.type === 'comment') continue
      if (t.type === 'string' && t.content === '*') starredHere = true
      break
    }

    if (name === 'newcommand' || name === 'renewcommand' || name === 'providecommand') {
      // unified-latex doesn't know newcommand's signature by default, so
      // arg shapes vary. Walk the args list looking for: first `{` group
      // is the macro name, optional `[n]` is the arg count, optional
      // `[default]` is the default for the first arg (we ignore it),
      // last `{` group is the body.
      const groupArgs = args.filter((a) => a.openMark === '{')
      const optionalArgs = args.filter((a) => a.openMark === '[')
      if (groupArgs.length < 2) continue
      const macroName = macroNameOf(groupArgs[0])
      if (!macroName) continue
      const numArgs = optionalArgs.length > 0 ? numericArg(optionalArgs[0]) ?? 0 : 0
      const body = printRaw(groupArgs[groupArgs.length - 1].content)
      // KaTeX deduces argument count from the highest #N in the body, so
      // we can pass the body as-is. We still record numArgs in case a
      // future KaTeX version needs it.
      void numArgs
      macros[macroName] = body
      continue
    }

    if (name === 'DeclareMathOperator') {
      const groupArgs = args.filter((a) => a.openMark === '{')
      if (groupArgs.length < 2) continue
      const macroName = macroNameOf(groupArgs[0])
      if (!macroName) continue
      const body = printRaw(groupArgs[1].content).trim()
      // Detect starred form. unified-latex captures `\DeclareMathOperator*`
      // as args = [{openMark:'', content:[{string:'*'}]}, {key}, {body}].
      const hasStarArg = args.some(
        (a) =>
          a.openMark === '' &&
          (a.content ?? []).some(
            (c: any) => c.type === 'string' && c.content === '*'
          )
      )
      const opName = (starredHere || hasStarArg) ? '\\operatorname*' : '\\operatorname'
      macros[macroName] = `${opName}{${body}}`
      continue
    }

    // \def\name{body} — TeX-primitive form. unified-latex parses these
    // as the `def` macro with the new macro and body as adjacent nodes.
    // Skip for now; users who need them can switch to \newcommand.
  }
  return macros
}

function extractDocumentClass(preamble: AstNodeArr): string {
  for (const n of preamble) {
    if (n.type === 'macro' && n.content === 'documentclass') {
      const required = (n.args ?? []).find((a: any) => a.openMark === '{')
      const cls = required ? printRawSafe(required.content).trim() : ''
      return cls || 'article'
    }
  }
  return 'article'
}

function printRawSafe(nodes: AstNodeArr): string {
  // Late-binding lazy import — synchronous fallback for nodes that arrived
  // after initial parse (rare). The module is already loaded at this point.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { printRaw } = require('@unified-latex/unified-latex-util-print-raw')
    return printRaw(nodes)
  } catch {
    return ''
  }
}

// ── Block-level conversion ──────────────────────────────────────────────

function nodesToBlocks(
  nodes: AstNodeArr,
  printRaw: (n: AstNodeArr) => string,
  titleMetadata?: TitleMetadata
): PMNode[] {
  const blocks: PMNode[] = []
  // We process the body as a sequence: a "section" macro starts a section,
  // and subsequent paragraph/math/figure blocks attach inside it until the
  // next section macro (of equal-or-shallower level) appears.

  type SectionFrame = {
    level: number
    titleInline: PMNode[]
    children: PMNode[]
    starred: boolean
    labels: string[]
  }
  const stack: SectionFrame[] = []

  const flushSection = (): void => {
    while (stack.length > 0) {
      const frame = stack.pop()!
      const sectionNode = buildSection(frame)
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(sectionNode)
      } else {
        blocks.push(sectionNode)
      }
    }
  }

  const pushBlock = (node: PMNode): void => {
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    else blocks.push(node)
  }

  // Paragraph content is buffered as AST nodes and converted in one
  // `inlineNodes` call at flush time. Converting node-by-node used to
  // split every run of text at each token boundary, which broke anything
  // that looks across characters — TeX's `---`/`--` ligatures in
  // particular, since unified-latex emits each `-` as its own node.
  let bufferNodes: AstNodeArr = []

  const flushParagraph = (): void => {
    const trimmed = trimInline(inlineNodes(bufferNodes, printRaw))
    if (trimmed.length > 0) {
      pushBlock(latexSchema.nodes.paragraph.create({}, trimmed))
    }
    bufferNodes = []
  }

  // True if everything after `idx` until the next parbreak/section/env is
  // also block-level (no real text content) — used to decide whether an
  // unknown macro at block-position is standalone (becomes rawLatex) or
  // followed by inline content (becomes part of a paragraph).
  const followedByInlineContent = (idx: number): boolean => {
    for (let j = idx + 1; j < nodes.length; j++) {
      const next = nodes[j]
      if (next.type === 'comment' || next.type === 'whitespace') continue
      if (next.type === 'parbreak') return false
      if (next.type === 'environment' || next.type === 'mathenv' || next.type === 'displaymath')
        return false
      if (next.type === 'macro') {
        const name = next.content as string
        if (SECTION_MACROS[name]) return false
        if (BLOCK_MACROS.has(name)) return false
        if (SILENT_MACROS.has(name)) continue
        return true
      }
      // A `group` immediately following a macro is almost always the
      // macro's argument that unified-latex didn't know about (because
      // it doesn't know the macro's signature). Don't treat it as
      // separate inline content — let the macro+group pattern be
      // handled as one block-level construct.
      if (next.type === 'group') return false
      return true
    }
    return false
  }

  const nextNonSpaceIsGroup = (idx: number): boolean => {
    for (let j = idx + 1; j < nodes.length; j++) {
      const next = nodes[j]
      if (next.type === 'whitespace' || next.type === 'comment') continue
      return next.type === 'group'
    }
    return false
  }

  // Greedily consume `[opt]` and `{...}` tokens that appear immediately
  // after a macro — they're almost always its arguments that unified-latex
  // didn't recognize. Returns the next index to resume from.
  const consumeMacroBody = (idx: number): { source: string; next: number } => {
    let last = idx
    let j = idx + 1
    while (j < nodes.length) {
      const next = nodes[j]
      if (next.type === 'whitespace' || next.type === 'comment') {
        j++
        continue
      }
      if (next.type === 'group') {
        last = j
        j++
        continue
      }
      // optional `[…]` arg shows up as a `string` "[" then content then "]"
      // — too fragile to consume confidently, so we stop here.
      break
    }
    // Slice the original bytes across the macro and every group it
    // swallowed, so `\cventry{a}{b}` keeps its exact spacing.
    const source = rawOfRange(nodes.slice(idx, last + 1), printRaw)
    // `next` must land after the last consumed group, not after the
    // trailing whitespace/comments we skipped while looking ahead.
    return { source, next: last + 1 }
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    // Skip whitespace/comments at block level — they're swallowed by paragraph
    // boundaries.
    if (n.type === 'comment') continue

    if (n.type === 'parbreak') {
      flushParagraph()
      continue
    }

    if (n.type === 'macro' && SECTION_MACROS[n.content]) {
      flushParagraph()
      // Pop sections until we find a parent with a strictly shallower level.
      const level = SECTION_MACROS[n.content]
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        const frame = stack.pop()!
        const sectionNode = buildSection(frame)
        if (stack.length > 0) stack[stack.length - 1].children.push(sectionNode)
        else blocks.push(sectionNode)
      }
      // Detect starred form `\section*{Title}` — unified-latex captures
      // the `*` as either a separate `string` sibling or a no-mark
      // argument with content `[{type:'string', content:'*'}]`.
      let starred = false
      const starInArgs = (n.args ?? []).some(
        (a: any) =>
          a.openMark === '' &&
          (a.content ?? []).some(
            (c: any) => c.type === 'string' && c.content === '*'
          )
      )
      if (starInArgs) starred = true
      else {
        for (let j = i + 1; j < nodes.length; j++) {
          const t = nodes[j]
          if (t.type === 'whitespace' || t.type === 'comment') continue
          if (t.type === 'string' && t.content === '*') {
            starred = true
            i = j // consume the star token
          }
          break
        }
      }
      const titleArg = (n.args ?? []).find((a: any) => a.openMark === '{')
      const titleContent: AstNodeArr = titleArg?.content ?? []
      // Pull any `\label{key}` out of the title — they're invisible at
      // render time but feed the cross-ref registry.
      const titleLabels = collectLabels(titleContent)
      const titleInline = inlineNodes(titleContent, printRaw)
      // Look-ahead for `\label{key}` siblings immediately after the
      // section macro (the more common LaTeX style).
      const trailingLabels: string[] = []
      while (i + 1 < nodes.length) {
        const t = nodes[i + 1]
        if (t.type === 'whitespace' || t.type === 'comment') {
          i++
          continue
        }
        if (t.type === 'macro' && t.content === 'label') {
          const arg = (t.args ?? []).find((a: any) => a.openMark === '{')
          const key = printRaw(arg?.content ?? []).trim()
          if (key) trailingLabels.push(key)
          i++
          continue
        }
        break
      }
      stack.push({
        level,
        titleInline,
        children: [],
        starred,
        labels: [...titleLabels, ...trailingLabels]
      })
      continue
    }

    // Block-level macros (\maketitle, \tableofcontents, \cventry, …) get
    // their own rawLatex block so they don't end up as inline text inside
    // a paragraph. We greedily consume any `{...}` groups following the
    // macro since unified-latex doesn't capture user/package macro args
    // by default — `\cventry{a}{b}{c}` arrives as 1 macro + 3 separate
    // groups in the AST, and we need all four in the rawLatex source.
    // A bare \includegraphics at block level (inside a float body, or a
    // centred image with no figure wrapper).
    if (n.type === 'macro' && n.content === 'includegraphics') {
      flushParagraph()
      const optional = (n.args ?? []).find((a: any) => a.openMark === '[')
      const required = (n.args ?? []).find((a: any) => a.openMark === '{')
      const options = optional ? printRaw(optional.content ?? []) : ''
      const width = /width\s*=\s*([^,\]]+)/.exec(options)?.[1]?.trim() ?? null
      pushBlock(
        latexSchema.nodes.figureImage.create({
          src: printRaw(required?.content ?? []).trim(),
          width,
          options
        })
      )
      continue
    }

    if (n.type === 'macro' && BLOCK_MACROS.has(n.content)) {
      flushParagraph()
      // \maketitle becomes a structured, editable titleBlock when we
      // have metadata extracted from the preamble. Without metadata
      // (e.g. metadata-less \maketitle in a partial doc) fall back to
      // the rawLatex placeholder.
      if (n.content === 'maketitle' && titleMetadata && titleMetadata.hasAny) {
        const tb = buildTitleBlock(titleMetadata, printRaw)
        if (tb) {
          pushBlock(tb)
          continue
        }
      }
      const { source, next } = consumeMacroBody(i)
      pushBlock(latexSchema.nodes.rawLatex.create({ source }))
      i = next - 1 // -1 because the for-loop increments
      continue
    }

    // Heuristic: an unknown macro at block-level position (no non-whitespace
    // text has accumulated yet) that has at least one required `{...}` arg
    // is almost certainly a structural macro — user-defined `\Colorhref`,
    // moderncv wrappers, `\title`/`\author`/`\date` siblings, etc. Treat
    // it as a rawLatex block rather than letting it leak into a paragraph.
    // Macros with no required args fall through to the inline path below.
    //
    // We treat a paragraph as "not yet started" if everything buffered so
    // far is whitespace — otherwise consecutive metadata macros separated
    // by a single newline (no parbreak) would all but the first leak.
    // Promote a block-position macro to a rawLatex block when:
    //   1. It has explicitly captured args (e.g. \title{x}), OR
    //   2. unified-latex didn't capture args but a `group` immediately
    //      follows it (e.g. \enumsentence{...}, \cventry{...}{...}{...}
    //      — common for user-defined / package-defined macros whose
    //      signature unified-latex doesn't know).
    // Either case: greedily consume any trailing groups so they round-trip.
    if (
      n.type === 'macro' &&
      isBlankAstBuffer(bufferNodes) &&
      !KNOWN_INLINE_MACROS.has(n.content) &&
      !followedByInlineContent(i) &&
      (hasRequiredArg(n) || nextNonSpaceIsGroup(i))
    ) {
      bufferNodes = []
      const { source, next } = consumeMacroBody(i)
      pushBlock(latexSchema.nodes.rawLatex.create({ source }))
      i = next - 1 // -1 because the for-loop increments
      continue
    }

    // `\begin{verbatim}` and friends arrive as a dedicated `verbatim` node
    // whose content is one opaque string.
    if (n.type === 'verbatim') {
      flushParagraph()
      pushBlock(
        latexSchema.nodes.codeBlock.create({
          code: stripEdgeNewlines(String((n as any).content ?? '')),
          env: (n as any).env ?? 'verbatim',
          options: '',
          language: ''
        })
      )
      continue
    }

    if (n.type === 'environment') {
      flushParagraph()
      if (CODE_ENVS.has(n.env)) {
        pushBlock(buildCodeBlock(n, printRaw))
        continue
      }
      if (MATH_BLOCK_ENVS.has(n.env)) {
        const label = extractLabel(n.content)
        pushBlock(
          latexSchema.nodes.mathBlock.create({
            latex: rawOfEnvironment(n, printRaw),
            label
          })
        )
        continue
      }
      if (FIGURE_ENVS.has(n.env)) {
        // A figure whose body is nothing but \includegraphics/\caption/
        // \label stays an atom `figure` node (simple, directly editable).
        // Anything richer — tikzpicture, subfigures, tabular — becomes a
        // floatBlock so the body isn't silently dropped on serialize.
        const simple = buildSimpleFigure(n, printRaw)
        pushBlock(simple ?? buildFloat(n, printRaw))
        continue
      }
      if (FLOAT_ENVS.has(n.env)) {
        pushBlock(buildFloat(n, printRaw))
        continue
      }
      if (LIST_ENVS.has(n.env)) {
        pushBlock(buildList(n, printRaw))
        continue
      }
      if (CONTAINER_ENVS.has(n.env)) {
        // Layout-only wrappers (`center`, `minipage`, `abstract`, …). They
        // hold ordinary block content, so they use the same node as floats
        // — which also means `\begin{center}`/`\end{center}` survives a
        // save instead of being silently deleted along with its arguments.
        pushBlock(buildFloat(n, printRaw))
        continue
      }
      if (THEOREM_ENVS.has(n.env)) {
        pushBlock(buildTheorem(n, printRaw))
        continue
      }
      if (BIBLIOGRAPHY_ENVS.has(n.env)) {
        pushBlock(buildBibliography(n, printRaw))
        continue
      }
      // Unknown environment → opaque rawLatex block. Slice the original
      // source so the environment's arguments (`\begin{tabular}{lccc}`)
      // and its internal line breaks survive; reconstructing it from
      // `printRaw(n.content)` dropped both.
      pushBlock(latexSchema.nodes.rawLatex.create({ source: rawOfEnvironment(n, printRaw) }))
      continue
    }

    if (
      n.type === 'displaymath' ||
      (n.type === 'group' && (n as any).env === 'displaymath')
    ) {
      flushParagraph()
      pushBlock(
        latexSchema.nodes.mathBlock.create({
          latex: rawOf(n, printRaw).trim() || `\\[${printRaw(n.content ?? [])}\\]`,
          label: null
        })
      )
      continue
    }

    // unified-latex emits `\begin{equation}…\end{equation}` and friends as
    // a dedicated `mathenv` node (not the generic `environment` type), so
    // they need a separate branch — otherwise they fall through and get
    // captured as inline math, which collapses the multi-line layout.
    //
    // The `env` field on mathenv is an Argument shape, not a plain string,
    // so the full `\begin{x}…\end{x}` form is read straight back out of
    // the source for storage.
    if (n.type === 'mathenv') {
      flushParagraph()
      const label = extractLabel((n as any).content ?? [])
      pushBlock(
        latexSchema.nodes.mathBlock.create({
          latex: rawOf(n, printRaw).trim(),
          label
        })
      )
      continue
    }

    // A `group` at block-level position is almost always a scoping
    // wrapper like `{\small … \enumsentence{…}}` — content inside should
    // be processed as block-level, not flattened into inline. Doing it
    // inline would lose block-macro detection for things inside the
    // group and rendering them as raw text.
    if (
      n.type === 'group' &&
      isBlankAstBuffer(bufferNodes) &&
      groupContainsBlockContent((n as any).content ?? [])
    ) {
      bufferNodes = []
      const inner = nodesToBlocks((n as any).content ?? [], printRaw)
      for (const child of inner) pushBlock(child)
      continue
    }

    // Inline-ish content collects into the current paragraph buffer.
    // For arg-consuming inline macros (\citep, \cref, …) whose `{…}` arg
    // Everything else is inline: buffer the AST node and let
    // `flushParagraph` convert the whole run at once. Batching is what
    // lets `inlineNodes` look ahead — e.g. to fold the `{…}` group after
    // `\citep` in as its argument when unified-latex didn't know the
    // macro's signature.
    bufferNodes.push(n)
  }

  flushParagraph()
  flushSection()

  return blocks
}

function buildSection(frame: {
  level: number
  titleInline: PMNode[]
  children: PMNode[]
  starred: boolean
  labels: string[]
}): PMNode {
  const id = slugFromInline(frame.titleInline)
  const title = latexSchema.nodes.sectionTitle.create({ level: frame.level }, frame.titleInline)
  const body = frame.children.length > 0 ? frame.children : [latexSchema.nodes.paragraph.create()]
  return latexSchema.nodes.section.create(
    { id, level: frame.level, starred: frame.starred, labels: frame.labels },
    [title, ...body]
  )
}

function buildTitleBlock(
  meta: TitleMetadata,
  printRaw: (n: AstNodeArr) => string
): PMNode | null {
  if (!meta.hasAny) return null
  const titleInline = inlineNodes(meta.titleNodes, printRaw)
  const titleHeading = latexSchema.nodes.titleHeading.create({}, titleInline)
  const children: PMNode[] = [titleHeading]

  if (meta.authorEntries.length > 0) {
    const entries: PMNode[] = []
    for (const entryNodes of meta.authorEntries) {
      const inline = inlineNodes(entryNodes, printRaw)
      // Collapse leading/trailing breaks so author blocks read cleanly.
      const trimmed = trimInlineWithBreaks(inline)
      entries.push(latexSchema.nodes.authorEntry.create({}, trimmed))
    }
    if (entries.length > 0) {
      children.push(latexSchema.nodes.authorList.create({}, entries))
    }
  }

  if (meta.dateNodes !== null) {
    const inline = meta.dateKind === 'today' ? [] : inlineNodes(meta.dateNodes, printRaw)
    children.push(latexSchema.nodes.titleDate.create({ kind: meta.dateKind }, inline))
  }

  return latexSchema.nodes.titleBlock.create({}, children)
}

// Like trimInline but treats hardBreak nodes as collapsible whitespace
// at the edges of an author entry (so `Name\\Affiliation\\` doesn't emit
// a trailing blank line).
function trimInlineWithBreaks(nodes: PMNode[]): PMNode[] {
  const out = [...nodes]
  const isBlank = (n: PMNode): boolean =>
    n.type.name === 'hardBreak' || (n.isText && (n.text ?? '').trim() === '')
  while (out.length > 0 && isBlank(out[0])) out.shift()
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop()
  return out
}

// Walk a flat AST node list and collect every `\label{key}` argument's
// stripped text. Used by the section parser to pick up labels declared
// inside the title brace, e.g. `\section{Title \label{sec:foo}}`.
function collectLabels(nodes: AstNodeArr): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.type === 'macro' && n.content === 'label') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      const text = (arg?.content ?? [])
        .map((c: any) => c.content ?? c.value ?? '')
        .join('')
        .trim()
      if (text) out.push(text)
    }
  }
  return out
}

function slugFromInline(inline: PMNode[]): string {
  let s = ''
  for (const n of inline) if (n.isText) s += n.text ?? ''
  s = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (!s) s = 'section'
  return `${s}-${Math.random().toString(36).slice(2, 6)}`
}

// Byte-exact `\begin{env}…\end{env}`, arguments included.
function rawOfEnvironment(envNode: any, printRaw: (n: AstNodeArr) => string): string {
  const span = spanOf(envNode)
  if (span) return sourceText.slice(span[0], span[1])
  // Fallback: rebuild, keeping the environment's arguments this time.
  const args = (envNode.args ?? [])
    .map((a: any) => {
      const inner = printRaw(a.content ?? [])
      if (!a.openMark) return inner
      return `${a.openMark}${inner}${a.closeMark ?? ''}`
    })
    .join('')
  return `\\begin{${envNode.env}}${args}${printRaw(envNode.content ?? [])}\\end{${envNode.env}}`
}

// Environment arguments, read back from the original source. `printRaw`
// would rewrite them (`\roman*` becomes `\roman{*}`, whitespace collapses),
// which silently changed enumitem list styling on every save.
function envArgTexts(
  envNode: any,
  printRaw: (n: AstNodeArr) => string
): Array<{ openMark: string; text: string }> {
  const args = (envNode.args ?? []).filter(
    (a: any) => a.openMark === '[' || a.openMark === '{'
  )
  if (args.length === 0) return []
  const start = envNode?.position?.start?.offset
  if (typeof start === 'number') {
    let cursor = start + `\\begin{${envNode.env}}`.length
    const out: Array<{ openMark: string; text: string }> = []
    let ok = true
    for (const a of args) {
      while (cursor < sourceText.length && /\s/.test(sourceText[cursor])) cursor++
      const close = a.openMark === '[' ? ']' : '}'
      const end = balancedEnd(cursor, a.openMark, close)
      if (end === null) {
        ok = false
        break
      }
      out.push({ openMark: a.openMark, text: sourceText.slice(cursor + 1, end - 1) })
      cursor = end
    }
    if (ok) return out
  }
  return args.map((a: any) => ({ openMark: a.openMark, text: printRaw(a.content ?? []) }))
}

// The `[…]` argument of an environment, without its brackets.
function optionalArgText(envNode: any, printRaw: (n: AstNodeArr) => string): string {
  return envArgTexts(envNode, printRaw).find((a) => a.openMark === '[')?.text ?? ''
}

// unified-latex only captures `[…]` as an argument for environments whose
// signature it knows. For everything else (`\begin{algorithm}[t]`,
// `\begin{theorem}[Title]`) the bracket group arrives as ordinary content
// nodes, so strip it off the front by hand.
function stripLeadingOptional(
  content: AstNodeArr,
  printRaw: (n: AstNodeArr) => string
): { text: string | null; rest: AstNodeArr } {
  const rest = content.slice()
  let i = 0
  while (i < rest.length && (rest[i].type === 'whitespace' || rest[i].type === 'comment')) i++
  if (!(i < rest.length && rest[i].type === 'string' && rest[i].content === '[')) {
    return { text: null, rest }
  }
  let depth = 1
  let j = i + 1
  const inner: AstNodeArr = []
  while (j < rest.length && depth > 0) {
    const t = rest[j]
    if (t.type === 'string' && t.content === '[') depth++
    if (t.type === 'string' && t.content === ']') {
      depth--
      if (depth === 0) break
    }
    inner.push(t)
    j++
  }
  if (depth !== 0) return { text: null, rest }
  rest.splice(i, j - i + 1)
  return { text: printRaw(inner).trim() || null, rest }
}

// Verbatim body text keeps its interior formatting but loses the newline
// that immediately follows `\begin{env}` and precedes `\end{env}` — those
// are delimiters, not content.
function stripEdgeNewlines(s: string): string {
  return s.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '')
}

function buildCodeBlock(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  const env = envNode.env as string
  const options = optionalArgText(envNode, printRaw)
  // `lstlisting[language=Python]`, `minted{python}`, `Verbatim[…]`.
  let language = /(?:^|,)\s*language\s*=\s*([A-Za-z+#-]+)/.exec(options)?.[1] ?? ''
  if (!language && env === 'minted') {
    const req = (envNode.args ?? []).find((a: any) => a.openMark === '{')
    if (req) language = printRaw(req.content ?? []).trim()
  }
  // The body is a single opaque string for verbatim-like environments;
  // slice the source anyway so nothing is normalised away.
  let code = ''
  const content = (envNode.content ?? []) as AstNodeArr
  if (content.length === 1 && content[0].type === 'string') {
    code = String(content[0].content ?? '')
  } else {
    code = rawOfRange(content, printRaw)
  }
  return latexSchema.nodes.codeBlock.create({
    code: stripEdgeNewlines(code),
    env,
    options,
    language
  })
}

const FLOAT_BODY_ALLOWED = new Set([
  'caption',
  'paragraph',
  'mathBlock',
  'listBlock',
  'rawLatex',
  'figureImage',
  'codeBlock',
  'floatBlock',
  'figure',
  'theoremEnv'
])

// `\begin{table}[t] … \end{table}` and friends. The caption and label are
// lifted onto the node (so the registry can number and resolve them) while
// everything else stays as editable block content.
function buildFloat(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  const kind = envNode.env as string
  // Arguments come from two places: ones unified-latex recognised (it
  // knows `minipage`'s signature) and ones it didn't (`\begin{algorithm}[t]`
  // arrives as plain `[`/`t`/`]` content nodes).
  const captured = envArgTexts(envNode, printRaw)
    .map((a) => (a.openMark === '[' ? `[${a.text}]` : `{${a.text}}`))
    .join('')
  const stripped = captured
    ? { text: null, rest: (envNode.content ?? []) as AstNodeArr }
    : stripLeadingOptional((envNode.content ?? []) as AstNodeArr, printRaw)
  const args = captured || (stripped.text !== null ? `[${stripped.text}]` : '')
  const content = stripped.rest

  let label: string | null = null
  let centering = false
  const rest: AstNodeArr = []
  const captionNodes: Array<{ index: number; node: PMNode }> = []

  for (const child of content) {
    if (child.type === 'macro' && child.content === 'label') {
      const arg = (child.args ?? []).find((a: any) => a.openMark === '{')
      label = label ?? (printRaw(arg?.content ?? []).trim() || null)
      continue
    }
    if (child.type === 'macro' && child.content === 'centering') {
      centering = true
      continue
    }
    if (child.type === 'macro' && child.content === 'caption') {
      const args = (child.args ?? []).filter((a: any) => a.openMark === '{')
      const optional = (child.args ?? []).find((a: any) => a.openMark === '[')
      const short = optional ? printRaw(optional.content ?? []).trim() || null : null
      const inline = inlineNodes(args[args.length - 1]?.content ?? [], printRaw)
      captionNodes.push({
        index: rest.length,
        node: latexSchema.nodes.caption.create({ short }, trimInline(inline))
      })
      continue
    }
    rest.push(child)
  }

  let blocks = nodesToBlocks(rest, printRaw)
  // Re-insert captions where they appeared relative to the other content
  // is more precision than we can recover after `nodesToBlocks` merges
  // paragraphs, so: a caption written before any content leads, otherwise
  // it trails. That matches how tables/algorithms are conventionally set.
  const leading = captionNodes.filter((c) => c.index === 0).map((c) => c.node)
  const trailing = captionNodes.filter((c) => c.index > 0).map((c) => c.node)
  blocks = blocks.filter((b) => FLOAT_BODY_ALLOWED.has(b.type.name))
  const children = [...leading, ...blocks, ...trailing]
  if (children.length === 0) children.push(latexSchema.nodes.paragraph.create())

  return latexSchema.nodes.floatBlock.create({ kind, args, label, centering }, children)
}

// A `figure` whose body is only \centering / \includegraphics / \caption /
// \label — the shape the atom `figure` node can represent losslessly.
// Returns null when the body holds anything else.
function buildSimpleFigure(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode | null {
  let src = ''
  let caption = ''
  let label: string | null = null
  let width: string | null = null
  let sawImage = false
  const captured = optionalArgText(envNode, printRaw)
  const stripped = stripLeadingOptional((envNode.content ?? []) as AstNodeArr, printRaw)
  const placement = captured || stripped.text || ''

  for (const child of stripped.rest) {
    if (child.type === 'whitespace' || child.type === 'comment' || child.type === 'parbreak') continue
    if (child.type !== 'macro') return null
    switch (child.content) {
      case 'includegraphics': {
        const optional = (child.args ?? []).find((a: any) => a.openMark === '[')
        const required = (child.args ?? []).find((a: any) => a.openMark === '{')
        if (optional) {
          const opts = printRaw(optional.content)
          const m = /width\s*=\s*([^,\]]+)/.exec(opts)
          if (m) width = m[1].trim()
        }
        src = printRaw(required?.content ?? []).trim()
        sawImage = true
        break
      }
      case 'caption': {
        const arg = (child.args ?? []).filter((a: any) => a.openMark === '{').pop()
        caption = printRaw(arg?.content ?? []).trim()
        break
      }
      case 'label': {
        const arg = (child.args ?? []).find((a: any) => a.openMark === '{')
        label = printRaw(arg?.content ?? []).trim() || null
        break
      }
      case 'centering':
        break
      default:
        return null
    }
  }
  if (!sawImage) return null
  return latexSchema.nodes.figure.create({ src, caption, label, width, placement })
}

function buildList(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  // unified-latex parses \item with the body of the item attached as its
  // LAST argument (preceding args are optional/label slots, often empty).
  // Split on \item: each item's content is either that last arg (preferred)
  // or, as a fallback for parsers that emit it as siblings, the nodes
  // between this \item and the next.
  const kind = envNode.env as string
  // enumitem's `[label=(\roman*)]` / `[leftmargin=*]` — kept verbatim so
  // the list numbering style isn't silently reset on the next save.
  const options = optionalArgText(envNode, printRaw)
  const items: Array<{ body: AstNodeArr; marker: string | null }> = []
  let current: { body: AstNodeArr; marker: string | null } | null = null
  for (const child of envNode.content as AstNodeArr) {
    if (child.type === 'macro' && child.content === 'item') {
      if (current) items.push(current)
      const args = (child.args ?? []) as Array<{ openMark?: string; content?: AstNodeArr }>
      // `\item[term]` — the description-list term, or an enumitem label
      // override. Either way it has to survive the round-trip.
      const optional = args.find((a) => a.openMark === '[')
      const marker = optional ? printRaw(optional.content ?? []).trim() || null : null
      const bodyArgs = args.filter((a) => a.openMark !== '[')
      const body = bodyArgs.length > 0 ? (bodyArgs[bodyArgs.length - 1]?.content ?? []) : []
      current = { body: body.length > 0 ? [...body] : [], marker }
    } else if (current !== null) {
      current.body.push(child)
    }
  }
  if (current) items.push(current)

  const itemNodes = items.map((item) => {
    const inline = inlineNodes(item.body, printRaw)
    const para = latexSchema.nodes.paragraph.create({}, trimInline(inline))
    return latexSchema.nodes.listItem.create({ marker: item.marker }, [para])
  })

  // Empty itemize → keep at least one empty bullet so structure stays.
  if (itemNodes.length === 0) {
    itemNodes.push(latexSchema.nodes.listItem.create({}, [latexSchema.nodes.paragraph.create()]))
  }
  return latexSchema.nodes.listBlock.create({ kind, options }, itemNodes)
}

function buildTheorem(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  const kind = envNode.env as string
  // Optional `[title]` immediately after \begin{kind}. unified-latex
  // doesn't know the signature so it shows up as the first content node:
  // a `string` of `[`, then content, then a `]`.
  const { text: title, rest: content } = stripLeadingOptional(
    envNode.content as AstNodeArr,
    printRaw
  )

  const label = extractLabel(content)
  let blocks = nodesToBlocks(content, printRaw)
  // The schema requires at least one allowed-content child; if everything
  // got dropped (rare — empty theorem), seed an empty paragraph.
  if (blocks.length === 0) blocks = [latexSchema.nodes.paragraph.create()]
  // Theorem schema only allows paragraph/mathBlock/listBlock/rawLatex/figure.
  // Strip out anything else (e.g. nested sections — unusual inside a
  // theorem) by rendering as rawLatex fallback.
  const allowed = new Set([
    'paragraph',
    'mathBlock',
    'listBlock',
    'rawLatex',
    'figure',
    'codeBlock',
    'floatBlock',
    'figureImage'
  ])
  blocks = blocks.filter((b) => allowed.has(b.type.name))
  if (blocks.length === 0) blocks = [latexSchema.nodes.paragraph.create()]
  return latexSchema.nodes.theoremEnv.create({ kind, label, title }, blocks)
}

function buildBibliography(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  // \begin{thebibliography}{widest-label} <bibitems> \end{thebibliography}.
  // The first required-arg of the env is the widest label string used to
  // size the entry-number column; we keep it for round-trip.
  const widestArg = (envNode.args ?? []).find((a: any) => a.openMark === '{')
  const widestLabel = widestArg ? printRaw(widestArg.content).trim() : ''

  const items: PMNode[] = []
  const content = envNode.content as AstNodeArr
  // Walk siblings, splitting on each \bibitem macro. Like \item, the
  // body of a bibitem is attached to the macro as its LAST argument
  // when unified-latex's signature recognizer kicks in; otherwise it
  // arrives as siblings up to the next \bibitem.
  let currentKey: string | null = null
  let currentLabel: string | null = null
  let currentBody: AstNodeArr = []

  const flush = (): void => {
    if (currentKey === null) return
    const inline = inlineNodes(currentBody, printRaw)
    items.push(
      latexSchema.nodes.bibitem.create(
        { key: currentKey, label: currentLabel },
        trimInline(inline)
      )
    )
    currentKey = null
    currentLabel = null
    currentBody = []
  }

  for (const child of content) {
    if (child.type === 'macro' && child.content === 'bibitem') {
      flush()
      const args = (child.args ?? []) as Array<{ openMark: string; content: AstNodeArr }>
      // unified-latex's default sig for \bibitem captures: optional [label],
      // required {key}, AND (like \item) the body as a trailing arg slot.
      // Walk args: first `[` is label, first `{` is key, last arg with
      // any content is the body.
      const optional = args.find((a) => a.openMark === '[')
      const required = args.filter((a) => a.openMark === '{')
      currentLabel = optional ? printRaw(optional.content).trim() || null : null
      currentKey = required[0] ? printRaw(required[0].content).trim() : ''

      // Find the body: the last arg in the args list whose content is
      // non-empty AND that isn't the {key} we already consumed. Handles
      // both attached-body case (args = [opt?, key, body]) and
      // sibling-body case (args = [opt?, key]).
      let body: AstNodeArr | null = null
      for (let k = args.length - 1; k >= 0; k--) {
        const a = args[k]
        if (a === required[0]) break // reached the key, stop
        if ((a.content ?? []).length > 0) {
          body = a.content
          break
        }
      }
      currentBody = body ? [...body] : []
    } else if (currentKey !== null) {
      currentBody.push(child)
    }
  }
  flush()

  return latexSchema.nodes.bibliography.create({ widestLabel }, items)
}

function extractLabel(nodes: AstNodeArr): string | null {
  for (const n of nodes) {
    if (n.type === 'macro' && n.content === 'label') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      return (arg?.content ?? []).map((c: any) => (c.content ?? c.value ?? '')).join('').trim() || null
    }
  }
  return null
}

// ── Inline-level conversion ─────────────────────────────────────────────

// TeX text ligatures: `---` is an em-dash, `--` an en-dash, `` ` `` and
// `'` are directional quotes, and `~` is a non-breaking space. We map `~`
// to U+00A0 rather than a plain space so `escapeLatex` can tell the two
// apart and re-emit `~` on serialize.
const NBSP = '\u00a0'
function applyLigatures(s: string): string {
  return s
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/~/g, NBSP)
}

function inlineNodes(nodes: AstNodeArr, printRaw: (n: AstNodeArr) => string): PMNode[] {
  const out: PMNode[] = []
  let textBuf = ''
  let activeMarks: string[] = []

  const flushText = (): void => {
    if (textBuf.length === 0) return
    const marks = activeMarks.map((m) => latexSchema.marks[m].create())
    out.push(latexSchema.text(applyLigatures(textBuf), marks))
    textBuf = ''
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.type === 'string') {
      // Ligatures are applied to the accumulated buffer in `flushText`,
      // not here: unified-latex splits punctuation into its own `string`
      // nodes, so `---` arrives as three separate `-` nodes and a
      // per-node replace never matched.
      textBuf += n.content as string
    } else if (n.type === 'verb') {
      // \verb|…| — the body is literal text, never LaTeX. Keeping the
      // exact delimiter means the round-trip re-emits identical source;
      // before this the body fell through the macro path and came out
      // mangled into stray pipes.
      flushText()
      const body = String((n as any).content ?? '')
      const escape = String((n as any).escape ?? '|')
      const env = String((n as any).env ?? 'verb')
      out.push(
        latexSchema.nodes.rawInline.create({
          source: '\\' + env + escape + body + escape,
          display: body
        })
      )
    } else if (n.type === 'whitespace') {
      textBuf += ' '
    } else if (n.type === 'comment') {
      // skip
    } else if (n.type === 'inlinemath' || n.type === 'mathenv') {
      flushText()
      // Byte-exact where possible: printRaw normalises math (`\R^d` comes
      // back as `\R^{d}`, spaces around operators shift), so every save
      // rewrote formulas the user never touched.
      const raw = rawOf(n, printRaw).trim()
      const inner = /^\$([\s\S]*)\$$/.exec(raw)?.[1]
      out.push(
        latexSchema.nodes.mathInline.create({ latex: inner ?? printRaw(n.content ?? []) })
      )
    } else if (n.type === 'macro') {
      flushText()
      // Some inline macros (\cite, \citep, \ref, \cref, \href, …) need a
      // following `{...}` argument. unified-latex doesn't know every
      // package's macro signatures by default — when an arg-expecting
      // macro has no captured `{`-arg and is immediately followed by a
      // `group` sibling, fold that group in as the macro's argument
      // before dispatching to macroToInline.
      const consumed = absorbTrailingArg(nodes, i, n)
      if (consumed.consumed > 0) i += consumed.consumed
      const node = macroToInline(consumed.macro, printRaw)
      if (Array.isArray(node)) out.push(...node)
      else if (node) out.push(node)
    } else if (n.type === 'group') {
      // Treat groups as transparent — their contents are inline.
      const nested = inlineNodes(n.content ?? [], printRaw)
      out.push(...nested)
    } else if (n.type === 'parbreak') {
      // Should be handled at block level — if it leaks here, just emit
      // a space so we don't lose word boundaries.
      textBuf += ' '
    }
  }

  flushText()
  return out
}

// Macros whose semantics require a brace argument that unified-latex
// often doesn't capture (because the package declaring them isn't in
// its built-in signature table). When we see one of these and it has
// no `{`-arg, look ahead for a group sibling and attach it.
const CITE_MACROS = new Set([
  'cite',
  'citep',
  'citet',
  'Citep',
  'Citet',
  'citealp',
  'citealt',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'parencite',
  'Parencite',
  'textcite',
  'Textcite',
  'autocite',
  'footcite',
  'citenum'
])

const REF_MACROS = new Set([
  'ref',
  'eqref',
  'autoref',
  'cref',
  'Cref',
  'crefrange',
  'Crefrange',
  'pageref',
  'nameref',
  'vref',
  'labelcref'
])

const ARG_CONSUMING_INLINE_MACROS = new Set([
  ...CITE_MACROS,
  ...REF_MACROS
])

function absorbTrailingArg(
  nodes: AstNodeArr,
  index: number,
  macro: any
): { macro: any; consumed: number } {
  const name = macro.content as string
  if (!ARG_CONSUMING_INLINE_MACROS.has(name)) return { macro, consumed: 0 }
  const args = (macro.args ?? []) as Array<any>
  if (args.some((a) => a.openMark === '{')) return { macro, consumed: 0 }
  // Peek ahead for a group sibling, skipping whitespace/comments.
  for (let j = index + 1; j < nodes.length; j++) {
    const t = nodes[j]
    if (t.type === 'whitespace' || t.type === 'comment') continue
    if (t.type === 'group') {
      const synthArg = { openMark: '{', closeMark: '}', content: t.content ?? [] }
      const merged = { ...macro, args: [...args, synthArg] }
      return { macro: merged, consumed: j - index }
    }
    break
  }
  return { macro, consumed: 0 }
}

function macroToInline(
  macro: any,
  printRaw: (n: AstNodeArr) => string
): PMNode | PMNode[] | null {
  const name = macro.content as string

  // `\footnote{…}` / `\thanks{…}`. Keeping the body as raw LaTeX (rather
  // than flattening it into the surrounding text, which is what used to
  // happen) means the marker renders where it belongs and the note text
  // round-trips unchanged.
  if (name === 'footnote' || name === 'thanks' || name === 'footnotetext') {
    const arg = (macro.args ?? []).filter((a: any) => a.openMark === '{').pop()
    const source = printRaw(arg?.content ?? []).trim()
    return latexSchema.nodes.footnote.create({ source, cmd: name })
  }
  if (name === 'footnotemark') {
    return latexSchema.nodes.footnote.create({ source: '', cmd: 'footnotemark' })
  }

  if (CITE_MACROS.has(name)) {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const keys = printRaw(arg?.content ?? [])
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
    // natbib/biblatex optional notes: `\citep[see][p.~4]{key}` — the
    // first `[…]` is the prenote only when a second one follows.
    const optionals = (macro.args ?? []).filter((a: any) => a.openMark === '[')
    let prenote: string | null = null
    let postnote: string | null = null
    if (optionals.length >= 2) {
      prenote = printRaw(optionals[0].content ?? []).trim()
      postnote = printRaw(optionals[1].content ?? []).trim()
    } else if (optionals.length === 1) {
      const text = printRaw(optionals[0].content ?? []).trim()
      // An empty captured `[]` slot is unified-latex padding, not a note.
      if (text) postnote = text
    }
    return latexSchema.nodes.citation.create({ keys, cmd: name, prenote, postnote })
  }
  if (REF_MACROS.has(name)) {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const raw = printRaw(arg?.content ?? []).trim()
    // \cref/\Cref accept comma-separated key lists.
    const keys = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return latexSchema.nodes.crossRef.create({
      label: keys[0] ?? '',
      keys,
      cmd: name
    })
  }
  if (name === 'textbf' || name === 'textit' || name === 'emph' || name === 'texttt' || name === 'textsc') {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const inner = inlineNodes(arg?.content ?? [], printRaw)
    const markName =
      name === 'textbf' ? 'strong'
      : name === 'texttt' ? 'code'
      : name === 'textsc' ? 'smallcaps'
      : 'em'
    return inner.map((node) => {
      if (!node.isText) return node
      const marks = node.marks.concat(latexSchema.marks[markName].create())
      return latexSchema.text(node.text!, marks)
    })
  }

  // \href{url}{text} — render visible text with a link mark carrying the URL.
  if (name === 'href') {
    const args = (macro.args ?? []).filter((a: any) => a.openMark === '{')
    const url = printRaw(args[0]?.content ?? []).trim()
    const textArg = args[1]?.content ?? args[0]?.content ?? []
    const inner = inlineNodes(textArg, printRaw)
    if (!url) return inner
    return inner.map((node) => {
      if (!node.isText) return node
      const marks = node.marks.concat(latexSchema.marks.link.create({ href: url }))
      return latexSchema.text(node.text!, marks)
    })
  }

  // \url{...} — show the URL itself with a link mark.
  if (name === 'url') {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const url = printRaw(arg?.content ?? []).trim()
    if (!url) return null
    return latexSchema.text(url, [latexSchema.marks.link.create({ href: url })])
  }

  // Transparent wrappers — content passes through with no mark.
  if (TRANSPARENT_INLINE_WRAPPERS.has(name)) {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    return inlineNodes(arg?.content ?? [], printRaw)
  }

  if (name === 'label') {
    // Labels attach to their containing block; ignore inline.
    return null
  }
  if (name === '\\' || name === 'newline') {
    return latexSchema.nodes.hardBreak.create()
  }

  // Silent layout macros. They produce no visible output, but they DO
  // affect the compiled PDF (`\noindent`, `\small`, …), so they survive
  // as an invisible rawInline rather than being deleted from the file.
  if (SILENT_MACROS.has(name)) {
    return latexSchema.nodes.rawInline.create({ source: `\\${name}`, display: '' })
  }

  // Spacing macros (\quad, \,, \;, …) → show a space, keep the macro.
  // Emitting a plain text space instead collapsed `\quad` into an ordinary
  // space on the next save.
  if (SPACE_MACROS.has(name)) {
    return latexSchema.nodes.rawInline.create({
      source: rawOf(macro, printRaw),
      display: name === 'qquad' ? '  ' : ' '
    })
  }

  // Known typographic / icon macros → Unicode glyph, source preserved.
  const glyph = ICON_MACRO_GLYPHS[name]
  if (glyph !== undefined) {
    return latexSchema.nodes.rawInline.create({
      source: rawOf(macro, printRaw),
      display: glyph
    })
  }

  // Unknown inline macro. If it has a `{...}` arg, recurse into the LAST
  // one — that's almost always the visible text in user-defined macros
  // like `\Colorhref{color}{url}{text}`.
  //
  // unified-latex doesn't know the signatures of user-defined macros, so
  // for things like `\Colorhref[opt]{a}{b}` the args list is empty and
  // the `[opt]` / `{a}` / `{b}` end up as following AST nodes — `[opt]`
  // as raw text, `{a}` and `{b}` as `group` nodes that the inline loop
  // recurses through transparently. Returning null here drops the
  // macro name itself; the group contents still render.
  const args = (macro.args ?? []).filter((a: any) => a.openMark === '{')
  if (args.length > 0) {
    return inlineNodes(args[args.length - 1].content ?? [], printRaw)
  }
  // A zero-argument macro we know nothing about. Dropping it silently
  // deleted it from the user's .tex on the next save; keep the source
  // and show it, so at least the loss is visible and reversible.
  return latexSchema.nodes.rawInline.create({
    source: `\\${name}`,
    display: `\\${name}`
  })
}

function trimInline(inline: PMNode[]): PMNode[] {
  // Collapse leading/trailing whitespace inside the paragraph.
  const out = [...inline]
  while (out.length > 0 && out[0].isText && (out[0].text ?? '').trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].isText && (out[out.length - 1].text ?? '').trim() === '') out.pop()
  return out
}
