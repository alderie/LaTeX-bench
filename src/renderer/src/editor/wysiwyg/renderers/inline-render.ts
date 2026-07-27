import katex from 'katex'
import { getMathMacros } from '../math-macros'

// Walk a string with brace-depth awareness and find every position of a
// top-level `$` (math toggle). Used to slice content into alternating
// text / math segments without tripping over `\$` or `${...}`.
function findMathSpans(s: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let depth = 0
  let inMath = false
  let mathStart = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      // Skip the next char so `\$`, `\{`, `\}` don't toggle anything.
      i++
      continue
    }
    if (c === '{') {
      depth++
      continue
    }
    if (c === '}') {
      depth--
      continue
    }
    if (c === '$' && depth === 0) {
      // Skip `$$` display delimiters — handled separately.
      if (s[i + 1] === '$') {
        i++
        continue
      }
      if (!inMath) {
        inMath = true
        mathStart = i + 1
      } else {
        inMath = false
        spans.push({ start: mathStart, end: i })
      }
    }
  }
  return spans
}

// Render `\textbf{...}`, `\emph{...}`, `\textit{...}`, `\texttt{...}` in
// plain text. Recursive; brace-depth aware. Returns a DocumentFragment.
function renderTextWithMarks(s: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  let i = 0
  while (i < s.length) {
    // Look for a recognized text macro at position i.
    const macroMatch = /^\\(textbf|textit|emph|texttt|textsc|mathbf|mathrm|mathit|mathsf|operatorname)\{/.exec(
      s.slice(i)
    )
    if (macroMatch) {
      const name = macroMatch[1]
      const argStart = i + macroMatch[0].length
      const argEnd = findMatchingBrace(s, argStart - 1)
      if (argEnd > 0) {
        const inner = s.slice(argStart, argEnd)
        const tag = pickTag(name)
        const el = document.createElement(tag)
        el.appendChild(renderTextWithMarks(inner))
        frag.appendChild(el)
        i = argEnd + 1
        continue
      }
    }
    // Backslash followed by a letter: it's a macro we don't recognize.
    // Drop the backslash so `\set` doesn't show literally — fall through
    // to consume just one char so we keep moving.
    if (s[i] === '\\' && /[a-zA-Z]/.test(s[i + 1] ?? '')) {
      // Find the macro name.
      let j = i + 1
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++
      // Skip subsequent `{...}` arg if present — render its inside as text.
      if (s[j] === '{') {
        const close = findMatchingBrace(s, j)
        if (close > 0) {
          frag.appendChild(renderTextWithMarks(s.slice(j + 1, close)))
          i = close + 1
          continue
        }
      }
      i = j
      continue
    }
    // Plain text run.
    let j = i
    while (j < s.length && s[j] !== '\\' && s[j] !== '{' && s[j] !== '}') j++
    if (j > i) {
      frag.appendChild(document.createTextNode(s.slice(i, j)))
      i = j
      continue
    }
    // Unmatched `{` or `}` — skip.
    i++
  }
  return frag
}

function pickTag(macroName: string): string {
  switch (macroName) {
    case 'textbf':
    case 'mathbf':
      return 'b'
    case 'textit':
    case 'mathit':
    case 'emph':
      return 'i'
    case 'texttt':
      return 'code'
    case 'textsc':
      return 'span'
    default:
      return 'span'
  }
}

function findMatchingBrace(s: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// Public: render mixed text/math LaTeX content (the kind that appears
// inside a tabular cell or an algorithm line) as DOM, with `$...$` math
// rendered through KaTeX and recognized text macros applied.
export function renderInlineLatex(source: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  const spans = findMathSpans(source)
  let cursor = 0
  for (const span of spans) {
    // Text before the math.
    const dollarStart = span.start - 1
    if (dollarStart > cursor) {
      frag.appendChild(renderTextWithMarks(source.slice(cursor, dollarStart)))
    }
    const math = source.slice(span.start, span.end)
    const el = document.createElement('span')
    try {
      katex.render(math, el, {
        throwOnError: false,
        displayMode: false,
        strict: false,
        macros: getMathMacros()
      })
    } catch {
      el.textContent = `$${math}$`
      el.style.color = 'var(--status-error)'
    }
    frag.appendChild(el)
    cursor = span.end + 1
  }
  if (cursor < source.length) {
    frag.appendChild(renderTextWithMarks(source.slice(cursor)))
  }
  return frag
}
