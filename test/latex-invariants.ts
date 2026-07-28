// Properties a LaTeX document keeps no matter what the editor does to it.
//
// The existing tests assert particular outputs for particular inputs, which
// catches what someone thought to write down. These are the other kind: a
// handful of facts that must hold for *every* document, checked against
// every fixture. A parser bug that nobody predicted shows up here as a
// citation key that went missing or an environment that lost its `\end`.
//
// Everything is a plain string function over LaTeX source, so a failure
// reports the actual token that moved rather than a diff of two 500-line
// files.

/** Strip comments so a `%` line can't be mistaken for content. */
export function stripComments(tex: string): string {
  return tex
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== '%') continue
        let backslashes = 0
        for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++
        if (backslashes % 2 === 0) return line.slice(0, i)
      }
      return line
    })
    .join('\n')
}

/**
 * Spans of the document where LaTeX's own rules are suspended.
 *
 * `\verb`, `verbatim` and `lstlisting` bodies contain braces and backslashes
 * that are text. Counting them as markup makes every other invariant here
 * report a false failure on any document that has code in it.
 */
function verbatimSpans(tex: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []

  for (const env of ['verbatim', 'lstlisting', 'Verbatim', 'minted', 'alltt']) {
    const re = new RegExp(`\\\\begin\\{${env}\\}`, 'g')
    let match: RegExpExecArray | null
    while ((match = re.exec(tex)) !== null) {
      const end = tex.indexOf(`\\end{${env}}`, match.index)
      if (end === -1) continue
      spans.push([match.index, end + `\\end{${env}}`.length])
    }
  }

  const verb = /\\verb\*?(.)/g
  let match: RegExpExecArray | null
  while ((match = verb.exec(tex)) !== null) {
    const close = tex.indexOf(match[1], match.index + match[0].length)
    if (close === -1) continue
    spans.push([match.index, close + 1])
  }

  return spans.sort((a, b) => a[0] - b[0])
}

/** The document with its verbatim spans blanked out, offsets preserved. */
export function stripVerbatim(tex: string): string {
  const chars = tex.split('')
  for (const [from, to] of verbatimSpans(tex)) {
    for (let i = from; i < to && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  }
  return chars.join('')
}

/** Comments and verbatim removed — what's left is markup. */
export function markupOnly(tex: string): string {
  return stripComments(stripVerbatim(tex))
}

// ── Balance ────────────────────────────────────────────────────────────

export interface BraceBalance {
  balanced: boolean
  depth: number
  /** Offset of the first `}` that closed nothing, when there is one. */
  firstUnderflow: number | null
}

/** Brace depth over the whole document, ignoring `\{`, comments, verbatim. */
export function braceBalance(tex: string): BraceBalance {
  const text = markupOnly(tex)
  let depth = 0
  let firstUnderflow: number | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth < 0 && firstUnderflow === null) firstUnderflow = i
    }
  }
  return { balanced: depth === 0 && firstUnderflow === null, depth, firstUnderflow }
}

/** Every `\begin{x}`/`\end{x}` name in order, for balance checking. */
export function environmentSequence(tex: string): Array<{ kind: 'begin' | 'end'; name: string }> {
  const out: Array<{ kind: 'begin' | 'end'; name: string }> = []
  for (const match of markupOnly(tex).matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
    out.push({ kind: match[1] as 'begin' | 'end', name: match[2] })
  }
  return out
}

export interface EnvBalance {
  balanced: boolean
  /** What went wrong, in the words of the first thing that did. */
  problem: string | null
}

/** `\begin` and `\end` nest properly and every one is closed by its own name. */
export function environmentBalance(tex: string): EnvBalance {
  const stack: string[] = []
  for (const token of environmentSequence(tex)) {
    if (token.kind === 'begin') {
      stack.push(token.name)
      continue
    }
    const open = stack.pop()
    if (open === undefined) {
      return { balanced: false, problem: `\\end{${token.name}} with no \\begin` }
    }
    if (open !== token.name) {
      return { balanced: false, problem: `\\end{${token.name}} closes \\begin{${open}}` }
    }
  }
  if (stack.length > 0) {
    return { balanced: false, problem: `\\begin{${stack[stack.length - 1]}} is never closed` }
  }
  return { balanced: true, problem: null }
}

// ── Content that must survive ──────────────────────────────────────────

/** Sorted `\label` keys. */
export function labels(tex: string): string[] {
  return [...markupOnly(tex).matchAll(/\\label\s*\{([^}]*)\}/g)].map((m) => m[1].trim()).sort()
}

/** Sorted citation keys, flattened out of every `\cite`-family macro. */
export function citeKeys(tex: string): string[] {
  const keys = new Set<string>()
  const re =
    /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite)\s*(?:\[[^\]]*\])*\s*\{([^}]*)\}/g
  for (const match of markupOnly(tex).matchAll(re)) {
    for (const key of match[1].split(',')) {
      const trimmed = key.trim()
      if (trimmed) keys.add(trimmed)
    }
  }
  return [...keys].sort()
}

/** Sorted `\bibitem` keys. */
export function bibitemKeys(tex: string): string[] {
  return [...markupOnly(tex).matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)]
    .map((m) => m[1].trim())
    .sort()
}

/**
 * Environment names and how many of each, as a sorted census.
 *
 * A count rather than a set: losing one of three `align` blocks is exactly
 * the kind of thing a set comparison hides.
 */
export function environmentCensus(tex: string): Record<string, number> {
  const census: Record<string, number> = {}
  for (const token of environmentSequence(tex)) {
    if (token.kind !== 'begin') continue
    census[token.name] = (census[token.name] ?? 0) + 1
  }
  return census
}

/** Bodies of the verbatim-like environments, which must survive byte-exact. */
export function verbatimBodies(tex: string): string[] {
  const out: string[] = []
  for (const env of ['verbatim', 'lstlisting']) {
    const re = new RegExp(
      `\\\\begin\\{${env}\\}(?:\\[[^\\]]*\\])?([\\s\\S]*?)\\\\end\\{${env}\\}`,
      'g'
    )
    for (const match of tex.matchAll(re)) out.push(match[1])
  }
  return out
}

/** `\verb` spans, delimiter included, which must survive byte-exact. */
export function verbSpans(tex: string): string[] {
  const out: string[] = []
  const re = /\\verb\*?(.)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(tex)) !== null) {
    const close = tex.indexOf(match[1], match.index + match[0].length)
    if (close === -1) continue
    out.push(tex.slice(match.index, close + 1))
    re.lastIndex = close + 1
  }
  return out
}

/**
 * Constructs that mean the document will not compile.
 *
 * Not a style opinion — each of these is a hard error from LaTeX, and each
 * has been produced by this editor at some point.
 */
export function fatalConstructs(tex: string): string[] {
  const found: string[] = []
  const text = markupOnly(tex)

  // `\begin{tabular}` with no column spec: LaTeX reads the next token as
  // the spec and aborts with "Use of \@array doesn't match its definition".
  for (const match of text.matchAll(/\\begin\{(tabular|array|longtable)\}\s*(.)/g)) {
    if (match[2] !== '{' && match[2] !== '[') {
      found.push(`\\begin{${match[1]}} with no column spec`)
    }
  }

  // An emptied key list followed by the keys as loose prose.
  for (const match of text.matchAll(/\\(cite|ref|label|eqref|cref|Cref)\{\}\s*[A-Za-z]/g)) {
    found.push(`\\${match[1]}{} with its argument spilled into the text`)
  }

  // A section command with no argument at all.
  for (const match of text.matchAll(/\\(section|subsection|subsubsection)\*?\s*(.)/g)) {
    if (match[2] !== '{' && match[2] !== '[') {
      found.push(`\\${match[1]} with no title argument`)
    }
  }

  return found
}
