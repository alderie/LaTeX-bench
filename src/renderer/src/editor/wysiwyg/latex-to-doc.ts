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
  subsubsection: 3
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
const LIST_ENVS = new Set(['itemize', 'enumerate'])

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
  'thanks',
  'subtitle',
  // bibliography helpers
  'nocite',
  'newbibliography',
  // misc spacing/structural
  'vfill',
  'medskip',
  'bigskip',
  'smallskip',
  'noindent'
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
  ...TRANSPARENT_INLINE_WRAPPERS,
  ...Object.keys(ICON_MACRO_GLYPHS),
  ...SPACE_MACROS,
  ...SILENT_MACROS
])

function hasRequiredArg(macro: any): boolean {
  const args = macro.args ?? []
  return args.some((a: any) => a.openMark === '{')
}

function isInlineBufferOnlyWhitespace(buf: PMNode[]): boolean {
  for (const n of buf) {
    if (!n.isText) return false
    if ((n.text ?? '').trim().length > 0) return false
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

export async function parseLatexToDoc(tex: string): Promise<ParseResult> {
  const { parse } = await loadParseModule()
  const { printRaw } = await loadPrintModule()

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
  const { titleMetadata, cleanedPreambleNodes } = hasMaketitle
    ? extractTitleMetadata(preambleNodes, printRaw)
    : { titleMetadata: undefined, cleanedPreambleNodes: preambleNodes }
  const preambleText = printRaw(cleanedPreambleNodes).trim()

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

function extractTitleMetadata(
  preamble: AstNodeArr,
  printRaw: (n: AstNodeArr) => string
): { titleMetadata: TitleMetadata; cleanedPreambleNodes: AstNodeArr } {
  const meta: TitleMetadata = {
    titleNodes: [],
    authorEntries: [],
    dateNodes: null,
    dateKind: 'literal',
    hasAny: false
  }
  const cleaned: AstNodeArr = []
  for (const n of preamble) {
    if (n.type === 'macro' && n.content === 'title') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      meta.titleNodes = arg?.content ?? []
      meta.hasAny = true
      continue
    }
    if (n.type === 'macro' && n.content === 'author') {
      const arg = (n.args ?? []).find((a: any) => a.openMark === '{')
      const content: AstNodeArr = arg?.content ?? []
      meta.authorEntries = splitOnAnd(content)
      meta.hasAny = true
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
      continue
    }
    cleaned.push(n)
  }
  return { titleMetadata: meta, cleanedPreambleNodes: cleaned }
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
  const macros: Record<string, string> = {}
  // Sensible defaults — these are amsmath/amssymb commands KaTeX already
  // knows but a stray \label inside math should be a no-op rather than
  // bleeding into adjacent tokens.
  macros['\\label'] = ''
  macros['\\nonumber'] = ''
  macros['\\notag'] = ''

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

  let bufferInline: PMNode[] = []

  const flushParagraph = (): void => {
    const trimmed = trimInline(bufferInline)
    if (trimmed.length > 0) {
      pushBlock(latexSchema.nodes.paragraph.create({}, trimmed))
    }
    bufferInline = []
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
    let source = printRaw([nodes[idx]])
    let j = idx + 1
    while (j < nodes.length) {
      const next = nodes[j]
      if (next.type === 'whitespace' || next.type === 'comment') {
        j++
        continue
      }
      if (next.type === 'group') {
        source += printRaw([next])
        j++
        continue
      }
      // optional `[…]` arg shows up as a `string` "[" then content then "]"
      // — too fragile to consume confidently, so we stop here.
      break
    }
    return { source, next: j }
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
      isInlineBufferOnlyWhitespace(bufferInline) &&
      !KNOWN_INLINE_MACROS.has(n.content) &&
      !followedByInlineContent(i) &&
      (hasRequiredArg(n) || nextNonSpaceIsGroup(i))
    ) {
      bufferInline = []
      const { source, next } = consumeMacroBody(i)
      pushBlock(latexSchema.nodes.rawLatex.create({ source }))
      i = next - 1 // -1 because the for-loop increments
      continue
    }

    if (n.type === 'environment') {
      flushParagraph()
      if (MATH_BLOCK_ENVS.has(n.env)) {
        const latex = `\\begin{${n.env}}${printRaw(n.content)}\\end{${n.env}}`
        const label = extractLabel(n.content)
        pushBlock(latexSchema.nodes.mathBlock.create({ latex, label }))
        continue
      }
      if (FIGURE_ENVS.has(n.env)) {
        pushBlock(buildFigure(n, printRaw))
        continue
      }
      if (LIST_ENVS.has(n.env)) {
        pushBlock(buildList(n, printRaw))
        continue
      }
      if (CONTAINER_ENVS.has(n.env)) {
        // Recurse into the body; each child becomes its own block. The
        // env wrapper is structural-only and round-trips by re-emitting
        // \begin{env}...\end{env} during serialization (handled by the
        // serializer for known containers).
        const inner = nodesToBlocks(n.content as AstNodeArr, printRaw)
        for (const child of inner) pushBlock(child)
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
      // Unknown environment → opaque rawLatex block.
      pushBlock(
        latexSchema.nodes.rawLatex.create({
          source: `\\begin{${n.env}}${printRaw(n.content)}\\end{${n.env}}`
        })
      )
      continue
    }

    if (
      n.type === 'displaymath' ||
      (n.type === 'group' && (n as any).env === 'displaymath')
    ) {
      flushParagraph()
      pushBlock(
        latexSchema.nodes.mathBlock.create({
          latex: `\\[${printRaw(n.content ?? [])}\\]`,
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
    // so we let printRaw([n]) reconstitute the full `\begin{x}…\end{x}`
    // form for storage; that string survives round-trip cleanly.
    if (n.type === 'mathenv') {
      flushParagraph()
      const label = extractLabel((n as any).content ?? [])
      pushBlock(
        latexSchema.nodes.mathBlock.create({
          latex: printRaw([n]).trim(),
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
      isInlineBufferOnlyWhitespace(bufferInline) &&
      groupContainsBlockContent((n as any).content ?? [])
    ) {
      bufferInline = []
      const inner = nodesToBlocks((n as any).content ?? [], printRaw)
      for (const child of inner) pushBlock(child)
      continue
    }

    // Inline-ish content collects into the current paragraph buffer.
    // For arg-consuming inline macros (\citep, \cref, …) whose `{…}` arg
    // unified-latex couldn't capture as a real `args` slot, we have to
    // hand the *macro AND its trailing group* to `inlineNodes` together
    // — the lookahead in `inlineNodes` can only see what's in the array
    // we pass it, and the default fallback passes one node at a time.
    if (n.type === 'macro' && ARG_CONSUMING_INLINE_MACROS.has(n.content)) {
      const chunk: AstNodeArr = [n]
      for (let j = i + 1; j < nodes.length; j++) {
        const t = nodes[j]
        if (t.type === 'whitespace' || t.type === 'comment') continue
        if (t.type === 'group') {
          chunk.push(t)
          i = j // consume the group from the outer loop
        }
        break
      }
      bufferInline.push(...inlineNodes(chunk, printRaw))
      continue
    }
    bufferInline.push(...inlineNodes([n], printRaw))
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

function buildFigure(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  // Look for \includegraphics{...} and \caption{...} \label{...} inside.
  let src = ''
  let caption = ''
  let label: string | null = null
  let width: string | null = null
  for (const child of envNode.content as AstNodeArr) {
    if (child.type === 'macro') {
      if (child.content === 'includegraphics') {
        const optional = (child.args ?? []).find((a: any) => a.openMark === '[')
        const required = (child.args ?? []).find((a: any) => a.openMark === '{')
        if (optional) {
          const opts = printRaw(optional.content)
          const m = /width\s*=\s*([^,\]]+)/.exec(opts)
          if (m) width = m[1].trim()
        }
        src = printRaw(required?.content ?? []).trim()
      } else if (child.content === 'caption') {
        const arg = (child.args ?? []).find((a: any) => a.openMark === '{')
        caption = printRaw(arg?.content ?? []).trim()
      } else if (child.content === 'label') {
        const arg = (child.args ?? []).find((a: any) => a.openMark === '{')
        label = printRaw(arg?.content ?? []).trim() || null
      }
    }
  }
  return latexSchema.nodes.figure.create({ src, caption, label, width })
}

function buildList(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  // unified-latex parses \item with the body of the item attached as its
  // LAST argument (preceding args are optional/label slots, often empty).
  // Split on \item: each item's content is either that last arg (preferred)
  // or, as a fallback for parsers that emit it as siblings, the nodes
  // between this \item and the next.
  const kind = envNode.env === 'enumerate' ? 'enumerate' : 'itemize'
  const items: AstNodeArr[] = []
  let current: AstNodeArr | null = null
  for (const child of envNode.content as AstNodeArr) {
    if (child.type === 'macro' && child.content === 'item') {
      if (current) items.push(current)
      const args = (child.args ?? []) as Array<{ content?: AstNodeArr }>
      const body = args.length > 0 ? (args[args.length - 1]?.content ?? []) : []
      current = body.length > 0 ? [...body] : []
    } else if (current !== null) {
      current.push(child)
    }
  }
  if (current) items.push(current)

  const itemNodes = items.map((arr) => {
    const inline = inlineNodes(arr, printRaw)
    const para = latexSchema.nodes.paragraph.create({}, trimInline(inline))
    return latexSchema.nodes.listItem.create({}, [para])
  })

  // Empty itemize → keep at least one empty bullet so structure stays.
  if (itemNodes.length === 0) {
    itemNodes.push(latexSchema.nodes.listItem.create({}, [latexSchema.nodes.paragraph.create()]))
  }
  return latexSchema.nodes.listBlock.create({ kind }, itemNodes)
}

function buildTheorem(envNode: any, printRaw: (n: AstNodeArr) => string): PMNode {
  const kind = envNode.env as string
  // Optional `[title]` immediately after \begin{kind}. unified-latex
  // doesn't know the signature so it shows up as the first content node:
  // a `string` of `[`, then content, then a `]`. Detect & strip.
  const content = (envNode.content as AstNodeArr).slice()
  let title: string | null = null
  // Skip leading whitespace.
  let i = 0
  while (i < content.length && (content[i].type === 'whitespace' || content[i].type === 'comment')) i++
  if (i < content.length && content[i].type === 'string' && content[i].content === '[') {
    let depth = 1
    let j = i + 1
    const titleNodes: AstNodeArr = []
    while (j < content.length && depth > 0) {
      const t = content[j]
      if (t.type === 'string' && t.content === '[') depth++
      if (t.type === 'string' && t.content === ']') {
        depth--
        if (depth === 0) break
      }
      titleNodes.push(t)
      j++
    }
    if (depth === 0) {
      title = printRaw(titleNodes).trim() || null
      content.splice(i, j - i + 1)
    }
  }

  const label = extractLabel(content)
  let blocks = nodesToBlocks(content, printRaw)
  // The schema requires at least one allowed-content child; if everything
  // got dropped (rare — empty theorem), seed an empty paragraph.
  if (blocks.length === 0) blocks = [latexSchema.nodes.paragraph.create()]
  // Theorem schema only allows paragraph/mathBlock/listBlock/rawLatex/figure.
  // Strip out anything else (e.g. nested sections — unusual inside a
  // theorem) by rendering as rawLatex fallback.
  const allowed = new Set(['paragraph', 'mathBlock', 'listBlock', 'rawLatex', 'figure'])
  blocks = blocks.map((b) =>
    allowed.has(b.type.name)
      ? b
      : latexSchema.nodes.rawLatex.create({ source: '' })
  )
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

function inlineNodes(nodes: AstNodeArr, printRaw: (n: AstNodeArr) => string): PMNode[] {
  const out: PMNode[] = []
  let textBuf = ''
  let activeMarks: string[] = []

  const flushText = (): void => {
    if (textBuf.length === 0) return
    const marks = activeMarks.map((m) => latexSchema.marks[m].create())
    out.push(latexSchema.text(textBuf, marks))
    textBuf = ''
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.type === 'string') {
      // Common LaTeX text shortcuts: ~ is a non-breaking space, --- is an
      // em-dash, -- is an en-dash. Map them to their visible characters so
      // the WYSIWYG view reads as prose. (escapeLatex on serialize would
      // turn `~` into `\textasciitilde{}` — to avoid that, we map `~` to
      // U+00A0 so the serializer can detect and re-emit `~`.)
      let s = n.content as string
      s = s.replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ')
      textBuf += s
    } else if (n.type === 'whitespace') {
      textBuf += ' '
    } else if (n.type === 'comment') {
      // skip
    } else if (n.type === 'inlinemath' || n.type === 'mathenv') {
      flushText()
      const latex = printRaw(n.content ?? [])
      out.push(latexSchema.nodes.mathInline.create({ latex }))
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
const ARG_CONSUMING_INLINE_MACROS = new Set([
  'cite',
  'citep',
  'citet',
  'citeauthor',
  'citeyear',
  'parencite',
  'textcite',
  'cref',
  'Cref',
  'autoref',
  'nameref',
  'pageref'
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

  if (name === 'cite' || name === 'citep' || name === 'citet' || name === 'citeauthor' || name === 'citeyear' || name === 'parencite' || name === 'textcite') {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const keys = printRaw(arg?.content ?? [])
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
    return latexSchema.nodes.citation.create({ keys })
  }
  if (
    name === 'ref' ||
    name === 'eqref' ||
    name === 'autoref' ||
    name === 'cref' ||
    name === 'Cref' ||
    name === 'pageref' ||
    name === 'nameref'
  ) {
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

  // Silent layout macros — emit nothing.
  if (SILENT_MACROS.has(name)) return null

  // Spacing macros (\quad, \,, \;, …) → emit a thin space.
  if (SPACE_MACROS.has(name)) {
    return latexSchema.text(name === 'qquad' ? '  ' : ' ')
  }

  // Known typographic / icon macros → Unicode glyph fallback.
  const glyph = ICON_MACRO_GLYPHS[name]
  if (glyph !== undefined) {
    return latexSchema.text(glyph)
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
  return null
}

function trimInline(inline: PMNode[]): PMNode[] {
  // Collapse leading/trailing whitespace inside the paragraph.
  const out = [...inline]
  while (out.length > 0 && out[0].isText && (out[0].text ?? '').trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].isText && (out[out.length - 1].text ?? '').trim() === '') out.pop()
  return out
}
