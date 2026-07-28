// The document's outline, extracted from LaTeX source.
//
// One definition of "what counts as a heading", shared by everything that
// asks the question: the command palette's jump list, the outline panel, the
// fold service's ranking, and the fold-to-level commands. They used to each
// carry their own regex and disagree — the palette recognised three macros
// while the fold service ranked five — so a `\chapter` was foldable but
// unjumpable, and a heading with a short-title argument was invisible to both.

/** Heading macros, shallowest first. Index is the rank. */
export const SECTION_MACROS = [
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph'
] as const

export type SectionMacro = (typeof SECTION_MACROS)[number]

/** Rank of each heading macro — lower is shallower. */
export const SECTION_RANK: Record<string, number> = Object.fromEntries(
  SECTION_MACROS.map((macro, index) => [macro, index])
)

/** Alternation fragment for building heading regexes elsewhere. */
export const SECTION_MACRO_PATTERN = SECTION_MACROS.join('|')

export interface SectionEntry {
  /** Absolute rank: 0 for `\part`, 2 for `\section`, … See SECTION_RANK. */
  level: number
  /** The macro that produced it, e.g. `subsection`. */
  macro: SectionMacro
  /**
   * Indent level for display, relative to the shallowest heading the document
   * actually uses. An article of `\section`s starts at 0 rather than being
   * indented twice for the `\part` and `\chapter` it doesn't have.
   */
  depth: number
  /** `\section*{…}` — present in the outline, absent from the numbering. */
  starred: boolean
  /** The heading's text, as written. Nested braces and math are preserved. */
  title: string
  /** Zero-based source line where the macro appears. */
  line: number
  /** Character offset where the macro starts. */
  offset: number
}

const SECTION_START_RE = new RegExp(`\\\\(${SECTION_MACRO_PATTERN})(\\*?)`, 'g')

export function extractSections(tex: string): SectionEntry[] {
  const commented = commentMask(tex)
  const found: Array<Omit<SectionEntry, 'depth'>> = []

  SECTION_START_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SECTION_START_RE.exec(tex)) !== null) {
    const offset = match.index
    if (commented[offset]) continue
    // `\sectionmark` and `\parts` start with a heading macro's name but
    // aren't one; a heading macro is never followed by another letter.
    const after = tex[offset + match[0].length]
    if (match[2] === '' && after !== undefined && /[a-zA-Z]/.test(after)) continue

    // `\section[Short form]{The full title}` — skip the optional argument.
    // Matching only `\section{` (as this used to) meant every heading with a
    // running-head variant was missing from the outline entirely.
    let cursor = skipSpace(tex, offset + match[0].length)
    if (tex[cursor] === '[') {
      const optional = readDelimited(tex, cursor, '[', ']')
      if (!optional) continue
      cursor = skipSpace(tex, optional.end)
    }
    if (tex[cursor] !== '{') continue

    const braced = readDelimited(tex, cursor, '{', '}')
    if (!braced) continue

    found.push({
      level: SECTION_RANK[match[1]],
      macro: match[1] as SectionMacro,
      starred: match[2] === '*',
      title: cleanTitle(braced.body),
      line: countLinesBefore(tex, offset),
      offset
    })
    SECTION_START_RE.lastIndex = braced.end
  }

  // Indent relative to the shallowest heading present, so the outline of an
  // article isn't pushed right by the `\part` levels it never uses.
  const shallowest = found.reduce((min, e) => Math.min(min, e.level), Number.POSITIVE_INFINITY)
  return found.map((entry) => ({ ...entry, depth: entry.level - shallowest }))
}

/**
 * The heading text on a single source line, or `''` if it isn't a heading.
 * The source view's breadcrumb reads this so it agrees with the outline.
 */
export function headingTitle(lineText: string): string {
  return extractSections(lineText)[0]?.title ?? ''
}

/**
 * Read a balanced `{…}` (or `[…]`) run starting at `open`.
 *
 * The reason this isn't `\{([^}]*)\}`: a heading in a maths paper routinely
 * contains braces of its own — `\section{The $\mathcal{O}(n)$ bound}` — and
 * stopping at the first `}` truncates the title to `The $\mathcal{O`.
 */
function readDelimited(
  text: string,
  open: number,
  openChar: string,
  closeChar: string
): { body: string; end: number } | null {
  if (text[open] !== openChar) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      // An escaped brace is a literal, not a delimiter.
      i++
      continue
    }
    if (char === '%' && !isEscaped(text, i)) {
      // A comment runs to the end of the line, braces included.
      const newline = text.indexOf('\n', i)
      if (newline === -1) return null
      i = newline
      continue
    }
    if (char === openChar) depth++
    else if (char === closeChar) {
      depth--
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 }
    }
  }
  return null
}

/**
 * Which characters sit inside a `%` comment.
 *
 * A commented-out `\section{Old draft}` is not part of the document and has
 * no business in its outline.
 */
function commentMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length)
  let inComment = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\n') {
      inComment = false
      continue
    }
    if (!inComment && char === '%' && !isEscaped(text, i)) inComment = true
    if (inComment) mask[i] = 1
  }
  return mask
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

function skipSpace(text: string, from: number): number {
  let i = from
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

/** Trim markup that is in the source but not in the heading you read. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function countLinesBefore(s: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset; i++) if (s.charCodeAt(i) === 10) count++
  return count
}
