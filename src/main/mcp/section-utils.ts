// Pure helpers shared by the MCP tools — operate on raw .tex strings so
// they're easy to unit-test and don't depend on Express or Electron.

export interface SectionRef {
  level: number
  title: string
  /** Character offset where the macro starts. */
  offset: number
  /** Character offset where the section ENDS (one past the last char). */
  endOffset: number
  /** Zero-based source line of the macro. */
  line: number
}

const SECTION_RE = /\\(section|subsection|subsubsection)\*?\s*\{([^}]*)\}/g

export function listSections(tex: string): SectionRef[] {
  const matches: { level: number; title: string; offset: number; line: number }[] = []
  let m: RegExpExecArray | null
  SECTION_RE.lastIndex = 0
  while ((m = SECTION_RE.exec(tex)) !== null) {
    const level = m[1] === 'section' ? 1 : m[1] === 'subsection' ? 2 : 3
    matches.push({
      level,
      title: m[2].trim(),
      offset: m.index,
      line: countLinesBefore(tex, m.index)
    })
  }
  // End-offset for each section = next section of same-or-shallower level,
  // or the start of \end{document}, or end-of-string. This is approximate
  // (matches the LaTeX semantics for sectioning) but good enough for an
  // MCP tool that wants to splice a section.
  const endOfDoc = findEndOfDocument(tex)
  const refs: SectionRef[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    let end = endOfDoc
    for (let j = i + 1; j < matches.length; j++) {
      if (matches[j].level <= cur.level) {
        end = matches[j].offset
        break
      }
    }
    refs.push({ ...cur, endOffset: end })
  }
  return refs
}

function findEndOfDocument(tex: string): number {
  const m = /\\end\{document\}/.exec(tex)
  return m ? m.index : tex.length
}

function countLinesBefore(s: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset; i++) if (s.charCodeAt(i) === 10) count++
  return count
}

export function findSection(tex: string, offset: number): SectionRef | null {
  return listSections(tex).find((s) => s.offset === offset) ?? null
}

export function replaceRange(tex: string, from: number, to: number, replacement: string): string {
  if (from < 0 || to < from || to > tex.length) {
    throw new Error(`replaceRange: out-of-bounds (from=${from}, to=${to}, len=${tex.length})`)
  }
  return tex.slice(0, from) + replacement + tex.slice(to)
}

export function appendBeforeEndDocument(tex: string, addition: string): string {
  const idx = findEndOfDocument(tex)
  if (idx >= tex.length) return tex.trimEnd() + '\n\n' + addition.trim() + '\n'
  return tex.slice(0, idx).trimEnd() + '\n\n' + addition.trim() + '\n\n' + tex.slice(idx)
}

export function searchText(
  haystack: string,
  query: string,
  useRegex: boolean
): { line: number; offset: number; snippet: string }[] {
  const results: { line: number; offset: number; snippet: string }[] = []
  if (!query) return results

  const re = useRegex ? new RegExp(query, 'g') : new RegExp(escapeRegex(query), 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(haystack)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++ // avoid zero-length infinite loops
    const line = countLinesBefore(haystack, m.index)
    const lineStart = lineStartOffset(haystack, m.index)
    const lineEnd = haystack.indexOf('\n', m.index)
    const snippet = haystack.slice(lineStart, lineEnd === -1 ? haystack.length : lineEnd).trim()
    results.push({ line, offset: m.index, snippet })
    if (results.length >= 200) break // hard cap to keep MCP responses small
  }
  return results
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lineStartOffset(s: string, offset: number): number {
  let i = offset
  while (i > 0 && s.charCodeAt(i - 1) !== 10) i--
  return i
}
