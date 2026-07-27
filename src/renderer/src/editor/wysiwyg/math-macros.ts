// KaTeX macro table shared by every renderer of math in this app.
//
// It lives in its own module so the WYSIWYG node view and the offline
// preview harness (scripts/render-preview.mjs) can't drift apart: a macro
// defined in one and not the other means the preview shows a red parse
// error for math the editor renders fine, or worse, the other way round.

export type MacroDefinition =
  | string
  | object
  | ((macroExpander: object) => string | object)
export type MacroMap = Record<string, MacroDefinition>

// `\label` MUST be defined as a 1-arg macro that throws away its argument —
// defining it as the empty string `''` makes KaTeX treat it as 0-arg, and
// the `{key}` argument falls through and renders as visible math text
// ("\labeleq:objective f(x) = …" in red, right inside the equation).
const labelMacro = (context: object): string => {
  // KaTeX's MacroExpander has a `consumeArgs(n)` method that grabs the next
  // n brace-groups from the token stream and returns them as already-
  // tokenised arrays. We discard them.
  ;(context as { consumeArgs: (n: number) => unknown[] }).consumeArgs(1)
  return ''
}

export const BUILTIN_MATH_MACROS: MacroMap = {
  '\\eqref': '\\href{###1}{(\\text{#1})}',
  '\\label': labelMacro,
  '\\nonumber': '',
  '\\notag': ''
  // Deliberately NOT defining `\tag`: the equation numbering injects real
  // `\tag{3}` calls into the display before handing it to KaTeX, and a
  // macro that ate its argument would swallow every equation number.
}

// The active table: built-ins plus whatever the current paper's preamble
// declared (\newcommand, \DeclareMathOperator, …). Module-scoped because
// every renderer of the current document shares it, and loading a different
// paper replaces it wholesale.
let currentMathMacros: MacroMap = { ...BUILTIN_MATH_MACROS }

export function setMathMacros(macros: Record<string, string>): void {
  currentMathMacros = { ...BUILTIN_MATH_MACROS, ...macros }
}

export function getMathMacros(): MacroMap {
  return currentMathMacros
}

/**
 * Strip wrappers KaTeX can't parse from a display-math block.
 *
 * `\[…\]` are delimiters, not an environment. `subequations` is a *numbering*
 * wrapper with no KaTeX equivalent — rendering it raw turns the whole group
 * red; the inner display carries the layout, and the (1a)/(1b) numbering
 * comes from the label registry regardless.
 */
export function stripMathWrappers(latex: string): string {
  const delimited = /^\s*\\\[([\s\S]*?)\\\]\s*$/.exec(latex)
  if (delimited) return delimited[1].trim()
  const sub = /^\s*\\begin\{subequations\}([\s\S]*?)\\end\{subequations\}\s*$/.exec(latex)
  if (sub) return sub[1].replace(/\\label\{[^}]*\}\s*(?=\\begin\{)/, '').trim()
  return latex
}

// Walk an env body and split on top-level `\\` (the row separator), so we
// can stitch a `\tag{N}` onto each line that should be numbered. Brace-
// depth aware; recognises the optional `[Npt]` spacing arg after `\\`.
function splitOnRowBreak(body: string): Array<{ text: string; sep: string }> {
  const out: Array<{ text: string; sep: string }> = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        let sepEnd = i + 2
        while (sepEnd < body.length && /\s/.test(body[sepEnd])) sepEnd++
        if (body[sepEnd] === '[') {
          const close = body.indexOf(']', sepEnd)
          if (close !== -1) sepEnd = close + 1
        }
        out.push({ text: body.slice(last, i), sep: body.slice(i, sepEnd) })
        last = sepEnd
        i = sepEnd
        continue
      }
      if (body[i + 1] === '{' || body[i + 1] === '}') {
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  out.push({ text: body.slice(last), sep: '' })
  return out
}

// If the registry has assigned numbers to this mathBlock's lines, splice
// `\tag{N}` into each numbered line's content. Lines marked unnumbered
// in the registry (because they had `\nonumber`/`\notag` or are blank)
// are left alone. KaTeX renders `\tag{}` as the flush-right marker.
export function injectEquationTags(
  latex: string,
  tags: Array<string | null> | undefined
): string {
  if (!tags || tags.length === 0) return latex
  const envMatch = /^(\s*)\\begin\{([a-zA-Z]+)(\*?)\}([\s\S]*?)\\end\{[a-zA-Z]+\*?\}(\s*)$/.exec(
    latex
  )
  if (!envMatch) return latex
  const [, lead, envName, , body, trail] = envMatch
  // Render through the STARRED variant and supply every number ourselves.
  // KaTeX numbers rows of `align`/`gather` automatically starting from 1,
  // which both restarted the count in each block and put numbers on rows
  // the document marked `\nonumber` (we strip `\nonumber` for KaTeX, so it
  // can't see them). Starred envs never auto-number, so `\tag{N}` is the
  // only thing that shows.
  const open = `${lead}\\begin{${envName}*}`
  const close = `\\end{${envName}*}${trail}`

  // Single-line env (equation) — append \tag{N} just before \end.
  if (tags.length === 1) {
    if (tags[0]) return `${open}${body.trimEnd()} \\tag{${tags[0]}}\n${close}`
    return `${open}${body}${close}`
  }
  const segments = splitOnRowBreak(body)
  if (segments.length !== tags.length) return latex // shape mismatch — leave alone
  const rebuilt = segments
    .map((seg, idx) => {
      const tag = tags[idx]
      const trimmed = seg.text.replace(/\s+$/, '')
      const withTag = tag ? `${trimmed} \\tag{${tag}}` : seg.text
      return withTag + seg.sep
    })
    .join('')
  return `${open}${rebuilt}${close}`
}

// For block math the latex may be stored as a full delimited form. KaTeX
// understands `\begin{equation}...\end{equation}`, `\begin{align*}...`, and
// the other math envs natively in displayMode — DO NOT strip those, or
// KaTeX loses alignment context and chokes on bare `&=` / `\\`. Only
// strip `\[...\]` since KaTeX does NOT recognize those as delimiters.
