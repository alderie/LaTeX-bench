import { describe, it, expect } from 'vitest'
import {
  extractSections,
  headingTitle,
  SECTION_RANK,
  SECTION_MACROS
} from '@renderer/editor/sections'

// The outline, which is the one definition of "what is a heading" that the
// jump list, the outline panel, the fold service and the breadcrumb share.

describe('extractSections', () => {
  it('keeps a title containing nested braces intact', () => {
    // The reason this exists: `\{([^}]*)\}` cut this to `The $\mathcal{O`.
    const sections = extractSections('\\section{The $\\mathcal{O}(n)$ bound}')
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('The $\\mathcal{O}(n)$ bound')
  })

  it('handles several levels of nesting', () => {
    const sections = extractSections('\\subsection{A {b {c} d} e}')
    expect(sections[0].title).toBe('A {b {c} d} e')
  })

  it('finds a heading that carries a short-title argument', () => {
    // `\section[Short]{Full}` matched nothing at all before, so every
    // heading with a running head was missing from the outline.
    const sections = extractSections('\\section[Short form]{The full title}')
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('The full title')
  })

  it('tolerates whitespace and newlines around the arguments', () => {
    const sections = extractSections('\\section\n  [Short]\n  {Full}')
    expect(sections[0].title).toBe('Full')
  })

  it('recognises every macro the fold service ranks', () => {
    const tex = SECTION_MACROS.map((m) => `\\${m}{${m} title}`).join('\n')
    const sections = extractSections(tex)
    expect(sections.map((s) => s.macro)).toEqual([...SECTION_MACROS])
    expect(sections.map((s) => s.level)).toEqual(SECTION_MACROS.map((m) => SECTION_RANK[m]))
  })

  it('indents relative to the shallowest heading actually used', () => {
    // An article of \sections should not be indented by the \part and
    // \chapter levels it does not have.
    const sections = extractSections('\\section{A}\n\\subsection{B}\n\\subsubsection{C}')
    expect(sections.map((s) => s.depth)).toEqual([0, 1, 2])
  })

  it('marks starred headings', () => {
    const sections = extractSections('\\section*{Acknowledgements}')
    expect(sections[0].starred).toBe(true)
    expect(sections[0].title).toBe('Acknowledgements')
  })

  it('skips headings that are commented out', () => {
    const sections = extractSections('% \\section{Old draft}\n\\section{Current}')
    expect(sections.map((s) => s.title)).toEqual(['Current'])
  })

  it('does not treat an escaped percent as starting a comment', () => {
    const sections = extractSections('100\\% \\section{Results}')
    expect(sections.map((s) => s.title)).toEqual(['Results'])
  })

  it('ignores macros that merely start with a heading name', () => {
    const sections = extractSections('\\sectionmark{Running head}\n\\section{Real}')
    expect(sections.map((s) => s.title)).toEqual(['Real'])
  })

  it('drops a \\label sitting inside the title', () => {
    const sections = extractSections('\\section{Method\\label{sec:method}}')
    expect(sections[0].title).toBe('Method')
  })

  it('reports the line and offset of each heading', () => {
    const tex = 'intro\n\\section{One}\nbody\n\\section{Two}'
    const sections = extractSections(tex)
    expect(sections.map((s) => s.line)).toEqual([1, 3])
    expect(tex.slice(sections[1].offset, sections[1].offset + 8)).toBe('\\section')
  })

  it('ignores a heading whose brace is never closed', () => {
    expect(extractSections('\\section{Unclosed')).toEqual([])
  })

  it('returns nothing for a document with no headings', () => {
    expect(extractSections('Just prose, and $x^2$.')).toEqual([])
  })
})

describe('headingTitle', () => {
  it('reads the title off a single line', () => {
    expect(headingTitle('  \\subsection{Background}')).toBe('Background')
  })

  it('reads past a short-title argument', () => {
    expect(headingTitle('\\section[Intro]{Introduction}')).toBe('Introduction')
  })

  it('is empty for a line that is not a heading', () => {
    expect(headingTitle('Some prose with {braces} in it.')).toBe('')
  })
})
