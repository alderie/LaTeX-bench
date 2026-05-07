import { Node as PMNode, Mark } from 'prosemirror-model'

const SECTION_MACRO_BY_LEVEL: Record<number, string> = {
  1: 'section',
  2: 'subsection',
  3: 'subsubsection'
}

export function serializeDocToLatex(doc: PMNode): string {
  const parts: string[] = []
  let preamble = ''

  doc.forEach((child) => {
    if (child.type.name === 'preamble') {
      preamble = (child.attrs.source as string).trim()
    }
  })

  if (preamble) parts.push(preamble)
  parts.push('\n\\begin{document}\n')

  doc.forEach((child) => {
    if (child.type.name === 'preamble') return
    parts.push(serializeBlock(child))
  })

  parts.push('\n\\end{document}\n')
  return parts.join('')
}

function serializeBlock(node: PMNode): string {
  switch (node.type.name) {
    case 'section': {
      const macro = SECTION_MACRO_BY_LEVEL[node.attrs.level as number] ?? 'section'
      let out = ''
      // First child is sectionTitle; rest are body blocks.
      const title = node.firstChild
      if (title && title.type.name === 'sectionTitle') {
        out += `\n\\${macro}{${serializeInline(title)}}\n`
      } else {
        out += `\n\\${macro}{}\n`
      }
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
    default:
      return ''
  }
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
    case 'crossRef':
      return `\\ref{${node.attrs.label as string}}`
    default:
      return ''
  }
}

const MARK_MACRO: Record<string, string> = {
  em: 'emph',
  strong: 'textbf',
  code: 'texttt'
}

function wrapMarks(text: string, marks: readonly Mark[]): string {
  if (marks.length === 0) return text
  let result = text
  for (const mark of marks) {
    const macro = MARK_MACRO[mark.type.name]
    if (macro) result = `\\${macro}{${result}}`
  }
  return result
}

function escapeLatex(s: string): string {
  // Minimal LaTeX escaping for special characters that aren't already
  // wrapped in math/raw nodes. Keep this conservative — over-escaping
  // breaks valid LaTeX in user input.
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}
