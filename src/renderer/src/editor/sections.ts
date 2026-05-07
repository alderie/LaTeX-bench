// Pure helper to extract section headings from a LaTeX source string.
// Used by both the source-mode CodeMirror integration and the command
// palette so jumps work regardless of the active editor.

export interface SectionEntry {
  level: number
  title: string
  /** Zero-based source line where the macro appears. */
  line: number
  /** Character offset where the macro starts. */
  offset: number
}

const SECTION_RE = /\\(section|subsection|subsubsection)\*?\s*\{([^}]*)\}/g

export function extractSections(tex: string): SectionEntry[] {
  const out: SectionEntry[] = []
  let match: RegExpExecArray | null
  SECTION_RE.lastIndex = 0
  while ((match = SECTION_RE.exec(tex)) !== null) {
    const macro = match[1]
    const title = match[2].trim()
    const offset = match.index
    const line = countLinesBefore(tex, offset)
    out.push({
      level:
        macro === 'section' ? 1 : macro === 'subsection' ? 2 : 3,
      title,
      line,
      offset
    })
  }
  return out
}

function countLinesBefore(s: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset; i++) if (s.charCodeAt(i) === 10) count++
  return count
}
