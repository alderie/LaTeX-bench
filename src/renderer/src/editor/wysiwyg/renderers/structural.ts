import { renderInlineLatex } from './inline-render'

// Structural macros that produce no text of their own but mark a boundary in
// the document: `\appendix`, `\tableofcontents`, `\newpage`, …
//
// These live in `rawLatex` nodes because there's nothing to edit about them,
// and the raw-block fallback rendered each as a grey monospace box of source.
// That reads as "the editor didn't understand this", when in fact we
// understand them completely — they're just not prose. A labelled rule says
// what the macro does and gets out of the way.

interface StructuralMacro {
  /** Text shown on the divider. */
  label: string
  /** A rule spanning the column, versus a small inline chip. */
  rule: boolean
}

const STRUCTURAL: Record<string, StructuralMacro> = {
  appendix: { label: 'Appendix', rule: true },
  tableofcontents: { label: 'Table of contents', rule: true },
  listoffigures: { label: 'List of figures', rule: true },
  listoftables: { label: 'List of tables', rule: true },
  printbibliography: { label: 'Bibliography', rule: true },
  bibliography: { label: 'Bibliography', rule: true },
  newpage: { label: 'Page break', rule: true },
  clearpage: { label: 'Page break', rule: true },
  pagebreak: { label: 'Page break', rule: true },
  maketitle: { label: 'Title block', rule: true },
  bibliographystyle: { label: 'Bibliography style', rule: false },
  nocite: { label: 'Cited without reference', rule: false },
  vfill: { label: 'Vertical fill', rule: false },
  bigskip: { label: 'Vertical space', rule: false },
  medskip: { label: 'Vertical space', rule: false },
  smallskip: { label: 'Vertical space', rule: false }
}

/** The macro name a structural raw block holds, or null if it isn't one. */
function structuralMacroOf(source: string): { name: string; arg: string | null } | null {
  // One macro, optionally with a single brace argument, and nothing else.
  const m = /^\s*\\([A-Za-z]+)\s*(?:\{([^{}]*)\})?\s*$/.exec(source)
  if (!m) return null
  if (!Object.prototype.hasOwnProperty.call(STRUCTURAL, m[1])) return null
  return { name: m[1], arg: m[2] ?? null }
}

export function isStructuralSource(source: string): boolean {
  return structuralMacroOf(source) !== null
}

export function renderStructural(source: string): HTMLElement {
  const found = structuralMacroOf(source)
  const wrapper = document.createElement('div')
  if (!found) {
    wrapper.textContent = source
    return wrapper
  }
  const spec = STRUCTURAL[found.name]
  wrapper.className = spec.rule ? 'structural-marker' : 'structural-marker structural-marker--chip'

  const label = document.createElement('span')
  label.className = 'structural-marker__label'
  label.textContent = spec.label
  if (found.arg) {
    const arg = document.createElement('span')
    arg.className = 'structural-marker__arg'
    arg.appendChild(renderInlineLatex(found.arg))
    label.appendChild(arg)
  }
  wrapper.appendChild(label)
  return wrapper
}
