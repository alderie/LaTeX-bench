import { Node as PMNode, Mark } from 'prosemirror-model'
import { encodeTextSymbols } from './text-symbols'

const SECTION_MACRO_BY_LEVEL: Record<number, string> = {
  1: 'section',
  2: 'subsection',
  3: 'subsubsection',
  4: 'paragraph',
  5: 'subparagraph'
}

export function serializeDocToLatex(doc: PMNode): string {
  const parts: string[] = []
  let preamble = ''
  let titleBlockNode: PMNode | null = null

  doc.forEach((child) => {
    if (child.type.name === 'preamble') {
      preamble = (child.attrs.source as string).trim()
    } else if (child.type.name === 'titleBlock' && titleBlockNode === null) {
      // Capture the FIRST titleBlock — there should only be one. The
      // metadata round-trips through the preamble, not through the body.
      titleBlockNode = child
    }
  })

  if (preamble) parts.push(preamble)
  if (titleBlockNode) {
    const meta = serializeTitleMetadata(titleBlockNode)
    if (meta) parts.push(`\n${meta}`)
  }
  parts.push('\n\\begin{document}\n')

  parts.push(
    serializeBlockSeq(childrenOf(doc).filter((child) => child.type.name !== 'preamble'))
  )

  parts.push('\n\\end{document}\n')
  return parts.join('')
}

// Re-emit the title metadata into the preamble. Returns "" if the block
// is empty.
function serializeTitleMetadata(node: PMNode): string {
  // Pull each field out of the block's children. Use `as` casts on the
  // accumulator types because closure-mutated locals can't keep their
  // narrowed types across the `forEach` boundary.
  let titleSrc = ''
  const authorEntries: string[] = []
  let dateSrc = '' as string
  let dateKind = 'literal' as string

  node.forEach((child) => {
    switch (child.type.name) {
      case 'titleHeading':
        titleSrc = serializeInline(child)
        break
      case 'authorList':
        child.forEach((entry) => {
          authorEntries.push(serializeInline(entry))
        })
        break
      case 'titleDate':
        dateKind = ((child.attrs.kind as string) || 'literal') as string
        dateSrc = serializeInline(child)
        break
    }
  })

  const lines: string[] = []
  if (titleSrc) lines.push(`\\title{${titleSrc.trim()}}`)
  if (authorEntries.length > 0) {
    const trimmed = authorEntries.map((s) => s.trim()).filter(Boolean)
    if (trimmed.length > 0) lines.push(`\\author{${trimmed.join(' \\and ')}}`)
  }
  if (dateKind === 'today') lines.push('\\date{\\today}')
  else if (dateSrc.trim() !== '') lines.push(`\\date{${dateSrc.trim()}}`)
  return lines.join('\n')
}

// Join a run of sibling blocks.
//
// Each `serializeBlock` result is trimmed and re-joined here rather than
// carrying its own separators, because the separator is a property of the
// *pair*: a blank line between a paragraph and the display equation it
// introduces would end the paragraph, so the equation stops being part of
// the sentence and the text after it gets indented as a new paragraph.
// Everywhere else a blank line is what an author would have written.
//
// Note the asymmetry: only the lead-in direction is glued. Text *after* a
// display stays its own paragraph, because gluing it on would silently
// un-indent it and there's no idiom making that the author's likely intent.
const NO_BLANK_LINE_BETWEEN = new Set(['paragraph>mathBlock', 'paragraph>codeBlock'])

function serializeBlockSeq(children: PMNode[]): string {
  const parts: Array<{ name: string; text: string }> = []
  for (const child of children) {
    const text = serializeBlock(child).replace(/^\n+/, '').replace(/\n+$/, '')
    if (text.length === 0) continue
    parts.push({ name: child.type.name, text })
  }
  return parts
    .map((part, i) => {
      if (i === 0) return part.text
      const sep = NO_BLANK_LINE_BETWEEN.has(`${parts[i - 1].name}>${part.name}`) ? '\n' : '\n\n'
      return sep + part.text
    })
    .join('')
}

function childrenOf(node: PMNode, skipFirst = false): PMNode[] {
  const out: PMNode[] = []
  node.forEach((child, _offset, index) => {
    if (skipFirst && index === 0) return
    out.push(child)
  })
  return out
}

// ── Line wrapping ──────────────────────────────────────────────────────
// The WYSIWYG view rewrites the whole file on every transaction, so an
// unwrapped serializer turns a hard-wrapped paper into one line per
// paragraph — a diff touching most of the file the first time a user types
// a character. Re-wrapping at the conventional width keeps the churn local.
//
// Breaks are only taken at spaces that are safe: not inside math, not
// inside a brace group (so `\cite{a, b}` and `\href{…}{…}` stay intact),
// and not inside a `\verb` span, where a newline changes the output.
const WRAP_WIDTH = 80

function safeBreakPoints(text: string): number[] {
  const points: number[] = []
  let depth = 0
  let inMath = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      // `\verb<delim>…<delim>` is literal: skip the whole span.
      const verb = /^\\verb\*?(.)/.exec(text.slice(i))
      if (verb) {
        const end = text.indexOf(verb[1], i + verb[0].length)
        i = end === -1 ? text.length : end
        continue
      }
      i++ // an escaped character is never a delimiter
      continue
    }
    if (c === '$') {
      inMath = !inMath
      continue
    }
    if (inMath) continue
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === ' ' && depth === 0) points.push(i)
  }
  return points
}

function wrapLatex(text: string, width = WRAP_WIDTH): string {
  if (text.length <= width || text.includes('\n')) return text
  const points = safeBreakPoints(text)
  if (points.length === 0) return text
  const out: string[] = []
  let start = 0
  let cursor = 0
  while (cursor < points.length) {
    // Furthest break that still fits, or the first one past the margin when
    // a single word is longer than the line.
    let chosen = -1
    while (cursor < points.length && points[cursor] - start <= width) {
      chosen = points[cursor]
      cursor++
    }
    if (chosen === -1) {
      chosen = points[cursor]
      cursor++
    }
    if (chosen === undefined || chosen <= start) break
    out.push(text.slice(start, chosen))
    start = chosen + 1
  }
  out.push(text.slice(start))
  return out.filter((line) => line.length > 0).join('\n')
}

function serializeBlock(node: PMNode): string {
  switch (node.type.name) {
    case 'section': {
      const macro = SECTION_MACRO_BY_LEVEL[node.attrs.level as number] ?? 'section'
      const star = (node.attrs.starred as boolean) ? '*' : ''
      const labels = (node.attrs.labels as string[]) ?? []
      let out = ''
      const title = node.firstChild
      const inline = title && title.type.name === 'sectionTitle' ? serializeInline(title) : ''
      out += `\n\\${macro}${star}{${inline}}`
      for (const lbl of labels) out += `\\label{${lbl}}`
      out += '\n'
      const body = serializeBlockSeq(childrenOf(node, true))
      if (body) out += `\n${body}\n`
      return out
    }
    case 'paragraph': {
      const inline = serializeInline(node).trim()
      return inline.length > 0 ? `\n${wrapLatex(inline)}\n` : ''
    }
    case 'mathBlock':
      return `\n${(node.attrs.latex as string).trim()}\n`
    case 'figure':
      return serializeFigure(node)
    case 'rawLatex':
      return `\n${(node.attrs.source as string).trim()}\n`
    case 'listBlock':
      return serializeList(node)
    case 'theoremEnv':
      return serializeTheorem(node)
    case 'bibliography':
      return serializeBibliography(node)
    case 'codeBlock':
      return serializeCodeBlock(node)
    case 'floatBlock':
      return serializeFloat(node)
    case 'caption': {
      const short = node.attrs.short as string | null
      const opt = short ? `[${short}]` : ''
      return `\n\\caption${opt}{${serializeInline(node).trim()}}\n`
    }
    case 'figureImage': {
      const options = (node.attrs.options as string) || ''
      const opt = options ? `[${options}]` : ''
      return `\n\\includegraphics${opt}{${node.attrs.src as string}}\n`
    }
    case 'titleBlock':
      // The metadata is round-tripped through the preamble already (via
      // serializeTitleMetadata); the block itself becomes a bare
      // `\maketitle` at its position in the body.
      return '\n\\maketitle\n'
    default:
      // Defensive: an unrecognized node type would otherwise be silently
      // serialized as empty, which deletes the user's content the next
      // time the WYSIWYG view writes back. Throw instead so the editor's
      // try/catch in dispatchTransaction logs and skips the save.
      throw new Error(
        `[doc-to-latex] no serializer for node type "${node.type.name}". ` +
          `Refusing to write — this would silently drop content from the .tex file.`
      )
  }
}

function serializeTheorem(node: PMNode): string {
  const kind = (node.attrs.kind as string) || 'theorem'
  const title = node.attrs.title as string | null
  const label = node.attrs.label as string | null
  const body = serializeBlockSeq(childrenOf(node))
  const open = title ? `\\begin{${kind}}[${title}]` : `\\begin{${kind}}`
  const lbl = label ? `\\label{${label}}` : ''
  return `\n${open}${lbl}\n${body.trim()}\n\\end{${kind}}\n`
}

function serializeBibliography(node: PMNode): string {
  const widest = (node.attrs.widestLabel as string) || '99'
  const items: string[] = []
  node.forEach((item) => {
    const key = (item.attrs.key as string) || ''
    const label = item.attrs.label as string | null
    const head = label ? `\\bibitem[${label}]{${key}}` : `\\bibitem{${key}}`
    items.push(`${head} ${serializeInline(item).trim()}`)
  })
  return `\n\\begin{thebibliography}{${widest}}\n${items.join('\n\n')}\n\\end{thebibliography}\n`
}

function serializeFigure(node: PMNode): string {
  const src = node.attrs.src as string
  const caption = node.attrs.caption as string
  const label = node.attrs.label as string | null
  const width = node.attrs.width as string | null
  const optional = width ? `[width=${width}]` : ''
  const placement = (node.attrs.placement as string) || 'htbp'
  let out = `\n\\begin{figure}[${placement}]\n  \\centering\n`
  if (src) out += `  \\includegraphics${optional}{${src}}\n`
  if (caption) out += `  \\caption{${caption}}\n`
  if (label) out += `  \\label{${label}}\n`
  out += '\\end{figure}\n'
  return out
}

function serializeCodeBlock(node: PMNode): string {
  const env = (node.attrs.env as string) || 'verbatim'
  const options = (node.attrs.options as string) || ''
  const opt = options ? `[${options}]` : ''
  const code = node.attrs.code as string
  // No indentation and no trimming: inside a verbatim environment every
  // character between the delimiters is content.
  return `\n\\begin{${env}}${opt}\n${code}\n\\end{${env}}\n`
}

function serializeFloat(node: PMNode): string {
  const kind = (node.attrs.kind as string) || 'table'
  const label = node.attrs.label as string | null
  const open = `\\begin{${kind}}${(node.attrs.args as string) || ''}`
  // Float bodies are structured content, not prose: `\centering`, the
  // graphic, and the caption belong on consecutive lines. A blank line
  // between them would start a new paragraph inside the float and add
  // vertical space the author never asked for.
  const parts: Array<{ name: string; text: string }> = []
  if (node.attrs.centering as boolean) parts.push({ name: 'centering', text: '\\centering' })

  // `\label` has to follow the `\caption` it belongs to — LaTeX resolves a
  // label against whatever counter was last stepped, so a label written
  // before the caption picks up the enclosing section's number instead of
  // the float's. It rides along on the caption's part; a float with no
  // caption gets it last.
  let labelled = false
  node.forEach((child) => {
    let text = serializeBlock(child).replace(/^\n+/, '').replace(/\n+$/, '')
    if (text.length === 0) return
    if (child.type.name === 'caption' && label && !labelled) {
      text += `\n\\label{${label}}`
      labelled = true
    }
    parts.push({ name: child.type.name, text })
  })
  if (label && !labelled) parts.push({ name: 'label', text: `\\label{${label}}` })

  const body = parts
    .map((part, i) => {
      if (i === 0) return part.text
      // Consecutive paragraphs are still prose and keep their blank line.
      const blank = parts[i - 1].name === 'paragraph' && part.name === 'paragraph'
      return (blank ? '\n\n' : '\n') + part.text
    })
    .join('')

  return `\n${open}\n${body}\n\\end{${kind}}\n`
}

function serializeList(node: PMNode): string {
  const kind = (node.attrs.kind as string) || 'itemize'
  const env =
    kind === 'enumerate' ? 'enumerate' : kind === 'description' ? 'description' : 'itemize'
  const options = (node.attrs.options as string) || ''
  const opt = options ? `[${options}]` : ''
  const items: string[] = []
  node.forEach((item) => {
    const body = serializeBlockSeq(childrenOf(item))
    const marker = item.attrs.marker as string | null
    // Indent continuation lines so a nested list reads as nested in the
    // source too, the way an author would have written it. Blank lines stay
    // blank — indenting them just leaves trailing whitespace.
    const text = body.trim().replace(/\n(?=[^\n])/g, '\n  ')
    items.push(`  \\item${marker ? `[${marker}]` : ''} ${text}`)
  })
  return `\n\\begin{${env}}${opt}\n${items.join('\n')}\n\\end{${env}}\n`
}

function serializeInline(node: PMNode): string {
  const children: PMNode[] = []
  node.forEach((child) => children.push(child))

  // Serialize *runs* of children that share a mark set, not one child at a
  // time. `\emph{The \TeX{}book}` holds a text node, an atom, and another
  // text node all carrying the em mark; wrapping each separately produced
  // `\emph{The }\TeX\emph{book}` — same output, but source the author
  // didn't write and wouldn't recognise.
  let out = ''
  let i = 0
  while (i < children.length) {
    const marks = children[i].marks
    let inner = ''
    let j = i
    while (j < children.length && Mark.sameSet(children[j].marks, marks)) {
      inner += serializeInlineChild(children[j], children[j + 1])
      j++
    }
    out += wrapMarks(inner, marks)
    i = j
  }
  return out
}

// TeX eats the whitespace after a control word, so `\LaTeX Round` sets
// "LaTeXRound". When a bare macro is followed by text that starts with a
// space, the macro needs a `{}` (or a backslash-space) to hold the gap open.
function needsSpacingGuard(source: string, next: PMNode | undefined): boolean {
  if (!/^\\[A-Za-z@]+$/.test(source)) return false
  if (!next) return false
  if (!next.isText) return false
  return /^\s/.test(next.text ?? '')
}

function serializeInlineChild(node: PMNode, next?: PMNode): string {
  if (node.isText) return escapeLatex(node.text ?? '')
  switch (node.type.name) {
    case 'mathInline': {
      const latex = (node.attrs.latex as string).trim()
      return `$${latex}$`
    }
    case 'citation': {
      const keys = (node.attrs.keys as string[]) ?? []
      const cmd = (node.attrs.cmd as string) || 'cite'
      const prenote = node.attrs.prenote as string | null
      const postnote = node.attrs.postnote as string | null
      // natbib reads a lone `[…]` as the POSTnote, so a prenote always
      // has to be written together with a (possibly empty) postnote.
      const notes =
        prenote !== null
          ? `[${prenote}][${postnote ?? ''}]`
          : postnote !== null
            ? `[${postnote}]`
            : ''
      return `\\${cmd}${notes}{${keys.join(',')}}`
    }
    case 'footnote': {
      const cmd = (node.attrs.cmd as string) || 'footnote'
      if (cmd === 'footnotemark') return '\\footnotemark'
      return `\\${cmd}{${node.attrs.source as string}}`
    }
    case 'rawInline': {
      const source = node.attrs.source as string
      return needsSpacingGuard(source, next) ? `${source}{}` : source
    }
    case 'crossRef': {
      const cmd = (node.attrs.cmd as string) || 'ref'
      const keys = (node.attrs.keys as string[]) ?? []
      const fallback = (node.attrs.label as string) || ''
      const list = keys.length > 0 ? keys.join(',') : fallback
      return `\\${cmd}{${list}}`
    }
    case 'hardBreak':
      return '\\\\'
    default:
      // Same reasoning as serializeBlock's default: silently returning ''
      // would delete the node from the .tex file on the next save.
      throw new Error(
        `[doc-to-latex] no serializer for inline node type "${node.type.name}". ` +
          `Refusing to write — this would silently drop content from the .tex file.`
      )
  }
}

const MARK_MACRO: Record<string, string> = {
  em: 'emph',
  strong: 'textbf',
  code: 'texttt',
  smallcaps: 'textsc',
  superscript: 'textsuperscript',
  subscript: 'textsubscript',
  underline: 'underline'
}

function wrapMarks(text: string, marks: readonly Mark[]): string {
  if (marks.length === 0) return text
  let result = text
  for (const mark of marks) {
    const name = mark.type.name
    if (name === 'link') {
      const href = (mark.attrs.href as string) || ''
      result = href ? `\\href{${href}}{${result}}` : result
      continue
    }
    const macro = MARK_MACRO[name]
    if (macro) result = `\\${macro}{${result}}`
  }
  return result
}

// Text → source. One pass, because a multi-pass replace re-escapes the
// braces it just inserted: `\\` became `\textbackslash{}` and the next
// rule turned that into `\textbackslash\{\}`, growing by two characters on
// every save until the paragraph was unreadable.
const ESCAPE_MAP: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  // The parser reads TeX's ligatures as the characters they set (`---` is an
  // em-dash); these put the idiomatic source shorthand back.
  '\u2014': '---',
  '\u2013': '--',
  '\u201c': '``',
  '\u201d': "''",
  '\u2018': '`',
  '\u2019': "'",
  '\u00a0': '~'
}

function escapeLatex(s: string): string {
  // Minimal LaTeX escaping for special characters that aren't already
  // wrapped in math/raw nodes. Keep this conservative — over-escaping
  // breaks valid LaTeX in user input.
  //
  // Accented and symbol characters go back out as their LaTeX escapes
  // (`\u00e9` → `\'{e}`) so the file compiles without depending on the document
  // loading `inputenc` — see text-symbols.ts. Characters with no known
  // escape pass through as UTF-8.
  return encodeTextSymbols(
    s.replace(/[\\&%$#_{}~^\u2014\u2013\u201c\u201d\u2018\u2019\u00a0]/g, (c) => ESCAPE_MAP[c] ?? c)
  )
}
