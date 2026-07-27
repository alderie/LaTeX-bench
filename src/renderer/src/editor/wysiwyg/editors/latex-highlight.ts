// LaTeX syntax highlighting for the plain-DOM editing surfaces.
//
// The source view has CodeMirror, which brings a parser, a theme and a
// gutter. The surfaces inside the paper — a formula, a table, the preamble —
// cannot: they live inside ProseMirror node views, are opened and thrown away
// on every click, and are sized by their content. Mounting a CodeMirror per
// equation to colour thirty characters is a lot of machinery to put between a
// keystroke and its repaint.
//
// So: a tokenizer small enough to run on every input event, and a `<pre>`
// painted behind a transparent `<textarea>` (see `code-field.ts`). The
// tokenizer is deliberately shallow — it does not know what a macro *means*,
// only what shape it has — which is all colour needs.
//
// Pure string work, no DOM, so the awkward parts (what `%` does inside a
// verbatim-ish body, whether `\\` is a macro or a row break) are testable.

export type TokenKind =
  /** `% to end of line` */
  | 'comment'
  /** `\alpha`, `\frac`, and single-character escapes like `\&`. */
  | 'command'
  /** The name inside `\begin{…}` / `\end{…}`. */
  | 'env'
  /** `{`, `}`, `[`, `]` — grouping, not content. */
  | 'brace'
  /** `$`, `$$`, `\[`, `\(` — a change of mode. */
  | 'math'
  /** `&` and `\\` — the things that make a body a grid. */
  | 'separator'
  /** `^` and `_`. */
  | 'script'
  | 'number'
  | 'text'

export interface Token {
  kind: TokenKind
  from: number
  to: number
}

/** Macros that structure a document rather than typeset something. */
const STRUCTURAL = new Set(['begin', 'end'])

/**
 * Split `source` into coloured runs.
 *
 * Every character of the input lands in exactly one token, in order, so a
 * renderer can concatenate token texts and get the source back — anything
 * else would silently drop characters from the surface the author is typing
 * into.
 */
export function tokenizeLatex(source: string): Token[] {
  const out: Token[] = []
  let textFrom = -1

  const flushText = (at: number): void => {
    if (textFrom === -1) return
    out.push({ kind: 'text', from: textFrom, to: at })
    textFrom = -1
  }
  const push = (kind: TokenKind, from: number, to: number): void => {
    flushText(from)
    out.push({ kind, from, to })
  }

  let i = 0
  while (i < source.length) {
    const c = source[i]

    if (c === '%') {
      const end = source.indexOf('\n', i)
      const to = end === -1 ? source.length : end
      push('comment', i, to)
      i = to
      continue
    }

    if (c === '\\') {
      const next = source[i + 1]
      // A row break, not a macro — and in a grid body it is the single most
      // useful thing to be able to see at a glance.
      if (next === '\\') {
        push('separator', i, i + 2)
        i += 2
        continue
      }
      if (next === '[' || next === ']' || next === '(' || next === ')') {
        push('math', i, i + 2)
        i += 2
        continue
      }
      if (next !== undefined && /[a-zA-Z]/.test(next)) {
        let end = i + 1
        while (end < source.length && /[a-zA-Z]/.test(source[end])) end++
        // `\begin{align}` — the environment name is the part worth reading,
        // so it is coloured as itself rather than as a brace group.
        const name = source.slice(i + 1, end)
        push('command', i, end)
        i = end
        if (STRUCTURAL.has(name)) i = highlightEnvArgument(source, i, out)
        continue
      }
      // `\&`, `\%`, `\{`: an escape is one token, so the character it
      // protects is never mistaken for structure.
      if (next !== undefined) {
        push('command', i, i + 2)
        i += 2
        continue
      }
      push('command', i, i + 1)
      i += 1
      continue
    }

    if (c === '$') {
      const double = source[i + 1] === '$'
      push('math', i, i + (double ? 2 : 1))
      i += double ? 2 : 1
      continue
    }

    if (c === '{' || c === '}' || c === '[' || c === ']') {
      push('brace', i, i + 1)
      i += 1
      continue
    }

    if (c === '&') {
      push('separator', i, i + 1)
      i += 1
      continue
    }

    if (c === '^' || c === '_') {
      push('script', i, i + 1)
      i += 1
      continue
    }

    if (/[0-9]/.test(c)) {
      let end = i
      while (end < source.length && /[0-9.]/.test(source[end])) end++
      push('number', i, end)
      i = end
      continue
    }

    if (textFrom === -1) textFrom = i
    i += 1
  }
  flushText(source.length)
  return out
}

/**
 * Colour the `{name}` after a `\begin` or `\end`, if it is there. Returns the
 * offset to carry on scanning from.
 */
function highlightEnvArgument(source: string, at: number, out: Token[]): number {
  const match = /^\{([a-zA-Z@]*\*?)\}/.exec(source.slice(at))
  if (!match) return at
  out.push({ kind: 'brace', from: at, to: at + 1 })
  if (match[1].length > 0) {
    out.push({ kind: 'env', from: at + 1, to: at + 1 + match[1].length })
  }
  out.push({ kind: 'brace', from: at + match[0].length - 1, to: at + match[0].length })
  return at + match[0].length
}

/**
 * Paint `source` into `host` as coloured spans.
 *
 * The trailing newline is the one detail that matters here: a `<pre>` whose
 * text ends in `\n` renders the same height as one that doesn't, so a
 * highlighted layer behind a textarea would drift up by a line the moment the
 * author pressed Return at the end. Ending on a real character fixes the
 * height without adding anything visible.
 */
export function paintLatex(source: string, host: HTMLElement): void {
  const fragment = document.createDocumentFragment()
  for (const token of tokenizeLatex(source)) {
    const text = source.slice(token.from, token.to)
    if (token.kind === 'text') {
      fragment.appendChild(document.createTextNode(text))
      continue
    }
    const span = document.createElement('span')
    span.className = `tok tok--${token.kind}`
    span.textContent = text
    fragment.appendChild(span)
  }
  fragment.appendChild(document.createTextNode('​'))
  host.replaceChildren(fragment)
}
