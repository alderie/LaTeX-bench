import { Node as PMNode, Mark } from 'prosemirror-model'

const SECTION_MACRO_BY_LEVEL: Record<number, string> = {
  1: 'section',
  2: 'subsection',
  3: 'subsubsection'
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

  doc.forEach((child) => {
    if (child.type.name === 'preamble') return
    parts.push(serializeBlock(child))
  })

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
      node.forEach((child, _, i) => {
        if (i === 0) return
        out += serializeBlock(child)
      })
      return out
    }
    case 'paragraph': {
      const inline = serializeInline(node).trim()
      return inline.length > 0 ? `\n${inline}\n` : ''
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
  let body = ''
  node.forEach((child) => {
    body += serializeBlock(child)
  })
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
  let out = '\n\\begin{figure}[htbp]\n  \\centering\n'
  if (src) out += `  \\includegraphics${optional}{${src}}\n`
  if (caption) out += `  \\caption{${caption}}\n`
  if (label) out += `  \\label{${label}}\n`
  out += '\\end{figure}\n'
  return out
}

function serializeList(node: PMNode): string {
  const env = node.attrs.kind === 'enumerate' ? 'enumerate' : 'itemize'
  const items: string[] = []
  node.forEach((item) => {
    let body = ''
    item.forEach((child) => {
      body += serializeBlock(child)
    })
    items.push(`  \\item ${body.trim()}`)
  })
  return `\n\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}\n`
}

function serializeInline(node: PMNode): string {
  let out = ''
  node.forEach((child) => {
    out += serializeInlineChild(child)
  })
  return out
}

function serializeInlineChild(node: PMNode): string {
  if (node.isText) {
    return wrapMarks(escapeLatex(node.text ?? ''), node.marks)
  }
  switch (node.type.name) {
    case 'mathInline': {
      const latex = (node.attrs.latex as string).trim()
      return `$${latex}$`
    }
    case 'citation': {
      const keys = (node.attrs.keys as string[]) ?? []
      return `\\cite{${keys.join(',')}}`
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
      return ''
  }
}

const MARK_MACRO: Record<string, string> = {
  em: 'emph',
  strong: 'textbf',
  code: 'texttt',
  smallcaps: 'textsc'
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

function escapeLatex(s: string): string {
  // Minimal LaTeX escaping for special characters that aren't already
  // wrapped in math/raw nodes. Keep this conservative — over-escaping
  // breaks valid LaTeX in user input.
  //
  // Round-trip notes: the parser maps `~` → U+00A0, `--` → U+2013, `---`
  // → U+2014 so the WYSIWYG view reads as prose. We reverse those here so
  // the .tex source keeps its idiomatic shortcuts on save.
  // Order matters: escape literal `~` BEFORE turning U+00A0 into `~`, so
  // round-tripped nbsps don't get re-escaped as \textasciitilde{}.
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/—/g, '---')
    .replace(/–/g, '--')
    .replace(/ /g, '~')
}
