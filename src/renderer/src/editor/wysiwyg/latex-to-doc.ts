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

// Macros that should be rendered as standalone block-level elements rather
// than swallowed into a paragraph. Anything here gets its own rawLatex
// node so the verbatim source survives a WYSIWYG round-trip.
const BLOCK_MACROS = new Set([
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
  'include'
])

export interface ParseResult {
  doc: PMNode
  preamble: string
  documentClass: string
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

  const preambleText = printRaw(preambleNodes).trim()
  const documentClass = extractDocumentClass(preambleNodes)

  const blocks = nodesToBlocks(bodyNodes, printRaw)

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
    documentClass
  }
}

function extractDocumentClass(preamble: AstNodeArr): string {
  for (const n of preamble) {
    if (n.type === 'macro' && n.content === 'documentclass') {
      const args = (n.args ?? []).map((a: any) => printRawSafe(a.content)).join(',')
      return args || 'article'
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

function nodesToBlocks(nodes: AstNodeArr, printRaw: (n: AstNodeArr) => string): PMNode[] {
  const blocks: PMNode[] = []
  // We process the body as a sequence: a "section" macro starts a section,
  // and subsequent paragraph/math/figure blocks attach inside it until the
  // next section macro (of equal-or-shallower level) appears.

  type SectionFrame = { level: number; titleInline: PMNode[]; children: PMNode[] }
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

  for (const n of nodes) {
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
      const titleArg = (n.args ?? []).find((a: any) => a.openMark === '{')
      const titleInline = inlineNodes(titleArg?.content ?? [], printRaw)
      stack.push({ level, titleInline, children: [] })
      continue
    }

    // Block-level macros (\maketitle, \tableofcontents, \newpage, …) get
    // their own rawLatex block so they don't end up as inline text inside
    // a paragraph. The verbatim source survives a WYSIWYG round-trip.
    if (n.type === 'macro' && BLOCK_MACROS.has(n.content)) {
      flushParagraph()
      pushBlock(latexSchema.nodes.rawLatex.create({ source: printRaw([n]) }))
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

    // Inline-ish content collects into the current paragraph buffer.
    bufferInline.push(...inlineNodes([n], printRaw))
  }

  flushParagraph()
  flushSection()

  return blocks
}

function buildSection(frame: { level: number; titleInline: PMNode[]; children: PMNode[] }): PMNode {
  const id = slugFromInline(frame.titleInline)
  const title = latexSchema.nodes.sectionTitle.create({ level: frame.level }, frame.titleInline)
  const body = frame.children.length > 0 ? frame.children : [latexSchema.nodes.paragraph.create()]
  return latexSchema.nodes.section.create({ id, level: frame.level }, [title, ...body])
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
  // Split on \item macros — group everything between two \items into a listItem.
  const kind = envNode.env === 'enumerate' ? 'enumerate' : 'itemize'
  const items: AstNodeArr[] = []
  let current: AstNodeArr | null = null
  for (const child of envNode.content as AstNodeArr) {
    if (child.type === 'macro' && child.content === 'item') {
      if (current) items.push(current)
      current = []
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

  for (const n of nodes) {
    if (n.type === 'string') {
      textBuf += n.content
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
      const node = macroToInline(n, printRaw)
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

function macroToInline(
  macro: any,
  printRaw: (n: AstNodeArr) => string
): PMNode | PMNode[] | null {
  const name = macro.content as string

  if (name === 'cite') {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const keys = printRaw(arg?.content ?? [])
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
    return latexSchema.nodes.citation.create({ keys })
  }
  if (name === 'ref' || name === 'eqref' || name === 'autoref') {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const label = printRaw(arg?.content ?? []).trim()
    return latexSchema.nodes.crossRef.create({ label })
  }
  if (name === 'textbf' || name === 'textit' || name === 'emph' || name === 'texttt') {
    const arg = (macro.args ?? []).find((a: any) => a.openMark === '{')
    const inner = inlineNodes(arg?.content ?? [], printRaw)
    const markName = name === 'textbf' ? 'strong' : name === 'texttt' ? 'code' : 'em'
    return inner.map((node) => {
      if (!node.isText) return node
      const marks = node.marks.concat(latexSchema.marks[markName].create())
      return latexSchema.text(node.text!, marks)
    })
  }
  if (name === 'label') {
    // Labels attach to their containing block; ignore inline.
    return null
  }
  if (name === '\\' || name === 'newline') {
    // Hard line breaks → space (we don't model hard breaks in this schema).
    return latexSchema.text(' ')
  }
  // Unknown macro — write the raw source as text so it's visible (and the
  // serializer will pick it up verbatim through round-trip via printRaw on
  // the original AST when we go back to source).
  const raw = printRaw([macro])
  return latexSchema.text(raw)
}

function trimInline(inline: PMNode[]): PMNode[] {
  // Collapse leading/trailing whitespace inside the paragraph.
  const out = [...inline]
  while (out.length > 0 && out[0].isText && (out[0].text ?? '').trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].isText && (out[out.length - 1].text ?? '').trim() === '') out.pop()
  return out
}
