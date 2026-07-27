// `\input` and `\include`: the other half of a paper.
//
// A paper of any size is not one file. The convention is a `main.tex` that is
// mostly preamble and a list of `\input{sections/method}` lines, with the
// prose in the files it names. Until now those lines were opaque: the rich
// view rendered them as a raw block, the outline stopped at the main file,
// and there was no way to open `sections/method.tex` at all.
//
// This module is the part that can be tested without a filesystem: finding
// the references and turning what they say into a paper-relative path. The
// walking of the resulting tree lives in `paperStore`, which has the I/O.

export type IncludeMacro = 'input' | 'include' | 'subfile' | 'subfileinclude'

export interface IncludeRef {
  macro: IncludeMacro
  /** The argument as written, e.g. `sections/method`. */
  raw: string
  /** Resolved paper-relative path with an extension, e.g. `sections/method.tex`. */
  path: string
  /** Zero-based source line the macro is on. */
  line: number
  /** Character offset where the macro starts. */
  offset: number
}

const INCLUDE_RE = /\\(input|include|subfile|subfileinclude)\s*\{([^}]*)\}/g

/**
 * Every file the given source pulls in, in source order.
 *
 * Commented-out lines are skipped: a `% \input{old-draft}` is not part of the
 * document, and listing it would put a file in the outline that the compiler
 * never reads.
 */
export function extractIncludes(tex: string): IncludeRef[] {
  const out: IncludeRef[] = []
  INCLUDE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INCLUDE_RE.exec(tex)) !== null) {
    if (isCommented(tex, match.index)) continue
    const raw = match[2].trim()
    const path = texPathFor(raw)
    if (!path) continue
    out.push({
      macro: match[1] as IncludeMacro,
      raw,
      path,
      line: countLinesBefore(tex, match.index),
      offset: match.index
    })
  }
  return out
}

/**
 * The file a `\input{…}` argument names.
 *
 * TeX supplies the `.tex` extension when there isn't one and treats `\` as a
 * path separator on no platform. Paths are resolved from the directory the
 * compiler runs in — the paper's root — not from the including file, which
 * is why nothing here is relative to anything. Anything that climbs out of
 * the paper folder is dropped rather than being asked for and refused later.
 */
export function texPathFor(raw: string): string | null {
  if (!raw) return null
  // `\input{\jobname-body}` and friends are computed at compile time; we
  // can't know what they resolve to without running TeX.
  if (raw.includes('\\') || raw.includes('#')) return null
  const cleaned = raw.replace(/^\.\//, '').replace(/"/g, '').trim()
  if (!cleaned) return null
  const withExt = /\.tex$/i.test(cleaned) ? cleaned : `${cleaned}.tex`
  const segments = withExt.split('/')
  if (segments.some((s) => s === '..' || s === '')) return null
  return segments.join('/')
}

function isCommented(text: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i]
    if (char === '\n') return false
    if (char === '%') {
      // `\%` is a literal percent sign, not a comment.
      let backslashes = 0
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++
      if (backslashes % 2 === 0) return true
    }
  }
  return false
}

function countLinesBefore(s: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset; i++) if (s.charCodeAt(i) === 10) count++
  return count
}
