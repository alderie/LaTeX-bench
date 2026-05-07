import { renderInlineLatex } from './inline-render'

const ALGORITHM_RE = /^\s*\\begin\{(algorithm\*?|algorithm2e|algorithmic)\}/

export function isAlgorithmSource(source: string): boolean {
  return ALGORITHM_RE.test(source.trim())
}

interface ParsedAlgorithm {
  caption: string
  label: string | null
  numbered: boolean
  lines: AlgLine[]
}

interface AlgLine {
  keyword: string | null // 'For', 'If', 'EndFor', 'State', 'Require', etc. — null = continuation
  arg: string | null // optional `{cond}` arg, e.g. for For/If/While
  content: string // the rest of the line's text
  indent: number // visual indentation level (0-based)
  showLineNumber: boolean
}

// Macros that delimit a single algorithm "line". Order matters only for
// readability — anything not in this set is treated as inline content
// belonging to the previous line.
const LINE_MACROS = new Set([
  'State',
  'Statex',
  'Require',
  'Ensure',
  'Input',
  'Output',
  'For',
  'ForAll',
  'EndFor',
  'While',
  'EndWhile',
  'Repeat',
  'Until',
  'If',
  'ElsIf',
  'Else',
  'EndIf',
  'Loop',
  'EndLoop',
  'Function',
  'EndFunction',
  'Procedure',
  'EndProcedure',
  'Return',
  'Print',
  'Comment'
])

const INDENT_OPENERS = new Set(['For', 'ForAll', 'While', 'If', 'Loop', 'Function', 'Procedure', 'Repeat'])
const INDENT_CLOSERS = new Set([
  'EndFor',
  'EndWhile',
  'EndIf',
  'EndLoop',
  'EndFunction',
  'EndProcedure',
  'Until'
])
const INDENT_HALF = new Set(['Else', 'ElsIf']) // dedent for the keyword line, then indent again

// Keywords that are visually structural delimiters rather than numbered
// statements — they sit between numbered lines without consuming a number.
const UNNUMBERED_KEYWORDS = new Set([
  'Require',
  'Ensure',
  'Input',
  'Output',
  'EndFor',
  'EndWhile',
  'EndIf',
  'EndLoop',
  'EndFunction',
  'EndProcedure',
  'Else',
  'ElsIf',
  'Until',
  'Comment'
])

// Walk source from `from` to find the matching {...} group; return
// {content, end} where `end` is index AFTER the closing `}`.
function readBraceArg(source: string, from: number): { content: string; end: number } | null {
  let i = from
  while (i < source.length && /\s/.test(source[i])) i++
  if (source[i] !== '{') return null
  let depth = 0
  const start = i + 1
  while (i < source.length) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { content: source.slice(start, i), end: i + 1 }
    }
    i++
  }
  return null
}

// Extract the value between `\begin{name}` and `\end{name}`; null if not
// present. Brace-depth aware enough for nested envs of a different name.
function extractEnv(source: string, name: string): string | null {
  const open = new RegExp(`\\\\begin\\{${name}\\}`)
  const close = new RegExp(`\\\\end\\{${name}\\}`)
  const o = open.exec(source)
  if (!o) return null
  const c = close.exec(source.slice(o.index + o[0].length))
  if (!c) return null
  const start = o.index + o[0].length
  return source.slice(start, start + c.index)
}

function parseAlgorithm(source: string): ParsedAlgorithm {
  // 1. caption + label sit between \begin{algorithm} and \begin{algorithmic}.
  let caption = ''
  let label: string | null = null
  const captionMatch = /\\caption\s*\{/.exec(source)
  if (captionMatch) {
    const arg = readBraceArg(source, captionMatch.index + captionMatch[0].length - 1)
    if (arg) caption = arg.content.trim()
  }
  const labelMatch = /\\label\s*\{/.exec(source)
  if (labelMatch) {
    const arg = readBraceArg(source, labelMatch.index + labelMatch[0].length - 1)
    if (arg) label = arg.content.trim()
  }

  // 2. body — between \begin{algorithmic}[N] and \end{algorithmic}.
  // Fall back to the `algorithm` body itself if no inner algorithmic env.
  let body = extractEnv(source, 'algorithmic') ?? extractEnv(source, 'algorithm\\*?')
  let numbered = false
  if (body !== null) {
    // Strip an optional `[N]` numbering directive at the start of the body.
    const optMatch = /^\s*\[(\d+)\]/.exec(body)
    if (optMatch) {
      numbered = parseInt(optMatch[1], 10) > 0
      body = body.slice(optMatch[0].length)
    } else {
      // The `[1]` may have been consumed as an optional arg of `\begin{algorithmic}`
      // — detect that by re-scanning the source.
      if (/\\begin\{algorithmic\}\s*\[\d+\]/.test(source)) numbered = true
    }
  } else {
    body = source
  }

  // 3. tokenize body into lines
  const lines: AlgLine[] = []
  let depth = 0
  let i = 0
  let currentLine: AlgLine | null = null

  const flush = (): void => {
    if (currentLine) {
      currentLine.content = currentLine.content.trim()
      lines.push(currentLine)
      currentLine = null
    }
  }

  const startLine = (keyword: string | null, arg: string | null): void => {
    flush()
    // Compute indent for this line.
    if (keyword && INDENT_CLOSERS.has(keyword) && depth > 0) depth--
    if (keyword && INDENT_HALF.has(keyword) && depth > 0) depth--
    const lineIndent = depth
    if (keyword && INDENT_OPENERS.has(keyword)) depth++
    if (keyword && INDENT_HALF.has(keyword)) depth++
    const showLineNumber =
      numbered &&
      keyword !== null &&
      !UNNUMBERED_KEYWORDS.has(keyword)
    currentLine = { keyword, arg, content: '', indent: lineIndent, showLineNumber }
  }

  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      // Read the macro name.
      let j = i + 1
      while (j < body.length && /[a-zA-Z]/.test(body[j])) j++
      const name = body.slice(i + 1, j)
      if (LINE_MACROS.has(name)) {
        // For line-level macros at depth 0, start a new line.
        if (depth === 0) {
          // `\State \Return X` and `\State \If{...}` are common idioms —
          // \State is being used to give the following macro a line number.
          // Skip the redundant \State and let the next macro own the line.
          if (name === 'State') {
            let k = j
            while (k < body.length && /\s/.test(body[k])) k++
            if (body[k] === '\\') {
              let m = k + 1
              while (m < body.length && /[a-zA-Z]/.test(body[m])) m++
              const nextName = body.slice(k + 1, m)
              if (LINE_MACROS.has(nextName) && nextName !== 'State') {
                i = j
                continue
              }
            }
          }
          // Some line macros take a `{cond}` arg (For, If, While, Until,
          // Function, Procedure, ElsIf). Capture it for nicer rendering.
          let arg: string | null = null
          let cursor = j
          if (
            name === 'For' ||
            name === 'ForAll' ||
            name === 'While' ||
            name === 'If' ||
            name === 'ElsIf' ||
            name === 'Until' ||
            name === 'Repeat'
          ) {
            const a = readBraceArg(body, cursor)
            if (a) {
              arg = a.content
              cursor = a.end
            }
          }
          if (name === 'Function' || name === 'Procedure') {
            // \Function{name}{args}
            const a1 = readBraceArg(body, cursor)
            const a2 = a1 ? readBraceArg(body, a1.end) : null
            if (a1 && a2) {
              arg = `${a1.content}(${a2.content})`
              cursor = a2.end
            } else if (a1) {
              arg = a1.content
              cursor = a1.end
            }
          }
          if (name === 'Comment') {
            const a = readBraceArg(body, cursor)
            if (a) {
              startLine(name, null)
              currentLine!.content = a.content
              i = a.end
              continue
            }
          }
          startLine(name, arg)
          i = cursor
          continue
        }
      }
      // Not a line macro (or not at depth 0): treat the whole `\name`
      // and any args as inline content for the current line.
      if (currentLine === null) startLine(null, null)
      currentLine!.content += body.slice(i, j)
      i = j
      continue
    }
    if (c === '{') {
      depth++
      if (currentLine === null) startLine(null, null)
      currentLine!.content += c
      i++
      continue
    }
    if (c === '}') {
      depth--
      if (currentLine === null) startLine(null, null)
      currentLine!.content += c
      i++
      continue
    }
    if (c === '\n' || c === '\r') {
      // Newlines are whitespace; collapse to a single space if we're
      // mid-line, otherwise drop.
      const cl = currentLine as AlgLine | null
      if (cl !== null && cl.content.length > 0) cl.content += ' '
      i++
      continue
    }
    if (currentLine === null) {
      // Stray plain text before any line macro — skip leading whitespace.
      if (/\s/.test(c)) {
        i++
        continue
      }
      startLine(null, null)
    }
    currentLine!.content += c
    i++
  }
  flush()

  return { caption, label, numbered, lines }
}

const KEYWORD_DISPLAY: Record<string, { pre: string; post?: string; class?: string }> = {
  For: { pre: 'for', post: 'do' },
  ForAll: { pre: 'for all', post: 'do' },
  EndFor: { pre: 'end for' },
  While: { pre: 'while', post: 'do' },
  EndWhile: { pre: 'end while' },
  Repeat: { pre: 'repeat' },
  Until: { pre: 'until' },
  If: { pre: 'if', post: 'then' },
  ElsIf: { pre: 'else if', post: 'then' },
  Else: { pre: 'else' },
  EndIf: { pre: 'end if' },
  Loop: { pre: 'loop' },
  EndLoop: { pre: 'end loop' },
  Function: { pre: 'function' },
  EndFunction: { pre: 'end function' },
  Procedure: { pre: 'procedure' },
  EndProcedure: { pre: 'end procedure' },
  Return: { pre: 'return' },
  Print: { pre: 'print' },
  Require: { pre: 'Require:', class: 'algorithm-block__keyword--label' },
  Ensure: { pre: 'Ensure:', class: 'algorithm-block__keyword--label' },
  Input: { pre: 'Input:', class: 'algorithm-block__keyword--label' },
  Output: { pre: 'Output:', class: 'algorithm-block__keyword--label' },
  Comment: { pre: '▷', class: 'algorithm-block__keyword--comment' }
}

export function renderAlgorithm(source: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'algorithm-block'
  const parsed = parseAlgorithm(source)

  if (parsed.caption) {
    const cap = document.createElement('div')
    cap.className = 'algorithm-block__caption'
    cap.appendChild(document.createTextNode('Algorithm '))
    cap.appendChild(renderInlineLatex(parsed.caption))
    wrapper.appendChild(cap)
  }

  const list = document.createElement('div')
  list.className = 'algorithm-block__lines'
  let visibleLineNo = 0
  for (const line of parsed.lines) {
    const row = document.createElement('div')
    row.className = 'algorithm-block__line'
    if (line.keyword === 'Comment') row.classList.add('algorithm-block__line--comment')

    const num = document.createElement('span')
    num.className = 'algorithm-block__lineno'
    if (line.showLineNumber) {
      visibleLineNo++
      num.textContent = String(visibleLineNo)
    }
    row.appendChild(num)

    const body = document.createElement('span')
    body.className = 'algorithm-block__body'
    body.style.paddingLeft = `${line.indent * 1.4}em`

    const display = line.keyword ? KEYWORD_DISPLAY[line.keyword] : null
    if (display) {
      const kw = document.createElement('span')
      kw.className = 'algorithm-block__keyword' + (display.class ? ' ' + display.class : '')
      kw.textContent = display.pre
      body.appendChild(kw)
      body.appendChild(document.createTextNode(' '))
    }

    if (line.arg) {
      body.appendChild(renderInlineLatex(line.arg))
      body.appendChild(document.createTextNode(' '))
    }
    if (display?.post) {
      const post = document.createElement('span')
      post.className = 'algorithm-block__keyword'
      post.textContent = display.post
      body.appendChild(post)
      body.appendChild(document.createTextNode(' '))
    }
    if (line.content) {
      body.appendChild(renderInlineLatex(line.content))
    }
    row.appendChild(body)
    list.appendChild(row)
  }
  wrapper.appendChild(list)
  return wrapper
}
