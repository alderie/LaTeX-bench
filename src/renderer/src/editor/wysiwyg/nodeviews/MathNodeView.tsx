import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { getEquationNumbersForPos, subscribe as subscribeRegistry } from '../labelRegistry'

// Per-paper KaTeX macros distilled from the document's preamble
// (\newcommand, \DeclareMathOperator, …). Set by the WysiwygEditor when it
// loads/reloads a paper. Module-scoped on purpose: every MathView in the
// current document shares the same macro table, and reloading a different
// paper replaces it wholesale.
//
// `\label` MUST be defined as a 1-arg macro that throws away its argument
// — defining it as the empty string `''` makes KaTeX treat it as 0-arg
// and the `{key}` argument falls through and renders as visible math text.
// `\nonumber`/`\notag` are genuinely 0-arg so empty-string is fine there.
type MacroDefinition = string | object | ((macroExpander: object) => string | object)
type MacroMap = Record<string, MacroDefinition>

const labelMacro = (context: object): string => {
  // KaTeX's MacroExpander has a `consumeArgs(n)` method that grabs the
  // next n brace-groups from the token stream and returns them as
  // already-tokenised arrays. We discard them.
  ;(context as { consumeArgs: (n: number) => unknown[] }).consumeArgs(1)
  return ''
}

const BUILTIN_MATH_MACROS: MacroMap = {
  '\\eqref': '\\href{###1}{(\\text{#1})}',
  '\\label': labelMacro,
  '\\nonumber': '',
  '\\notag': ''
}

let currentMathMacros: MacroMap = { ...BUILTIN_MATH_MACROS }

export function setMathMacros(macros: Record<string, string>): void {
  currentMathMacros = { ...BUILTIN_MATH_MACROS, ...macros }
}

export function getMathMacros(): MacroMap {
  return currentMathMacros
}

class MathView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement
  private editing = false
  private editor?: HTMLInputElement | HTMLTextAreaElement
  private unsubscribe: (() => void) | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private displayMode: boolean
  ) {
    this.dom = document.createElement(displayMode ? 'div' : 'span')
    this.dom.className = displayMode ? 'math-block' : 'math-inline'
    this.dom.contentEditable = 'false'
    this.render()

    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      if (!this.editing) this.openEditor()
    })

    // Display-mode math is the only kind we renumber. Re-render when
    // the registry's per-position equation numbers change.
    if (this.displayMode) {
      this.unsubscribe = subscribeRegistry(() => {
        if (!this.editing) this.render()
      })
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.editing) this.render()
    return true
  }

  private render(): void {
    this.dom.replaceChildren()
    const rawLatex = (this.node.attrs.latex as string) ?? ''
    let latex = stripWrappers(rawLatex, this.displayMode).trim()
    if (this.displayMode) {
      latex = injectEquationTags(latex, this.getPos())
    }
    // Set anchor id so cleveref-style cross-refs can scroll into view.
    if (this.displayMode) {
      const primaryLabel = this.node.attrs.label as string | null
      if (primaryLabel) {
        this.dom.id = `latex-anchor-${primaryLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      } else {
        this.dom.removeAttribute('id')
      }
    }
    try {
      katex.render(latex, this.dom, {
        throwOnError: false,
        displayMode: this.displayMode,
        // KaTeX needs both HTML and MathML by default for `align*` and friends
        // to lay out their alignment columns correctly. Forcing 'html' alone
        // silently drops the intercolumn spacing on some envs.
        strict: false,
        macros: currentMathMacros
      })
      this.dom.style.color = ''
      this.dom.title = ''
    } catch (err) {
      this.dom.textContent = latex
      this.dom.style.color = 'var(--status-error)'
      this.dom.title = (err as Error).message
    }
  }

  private openEditor(): void {
    this.editing = true
    this.dom.replaceChildren()
    // Inline math uses an <input> with field-sizing:content so it grows
    // with the text and aligns to the surrounding baseline. Block math
    // keeps a textarea (multi-line LaTeX), but loses the resize grip and
    // browser-default chrome via CSS.
    const el = this.displayMode
      ? document.createElement('textarea')
      : document.createElement('input')
    el.className = this.displayMode ? 'math-block__editor' : 'math-inline__editor'
    el.value = this.node.attrs.latex as string
    el.spellcheck = false
    el.autocomplete = 'off'
    if (el instanceof HTMLInputElement) el.type = 'text'
    if (el instanceof HTMLTextAreaElement) {
      el.rows = Math.max(2, el.value.split('\n').length)
      // Auto-grow as the user types; field-sizing:content also handles
      // this in newer Chromium but rows-based fallback works everywhere.
      const autosize = (): void => {
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      }
      el.addEventListener('input', autosize)
      requestAnimationFrame(autosize)
    }
    this.editor = el
    this.dom.appendChild(el)
    requestAnimationFrame(() => {
      el.focus()
      // Place caret at end so the user is ready to extend the formula.
      try {
        const len = el.value.length
        if (el instanceof HTMLInputElement) el.setSelectionRange(len, len)
        else el.setSelectionRange(len, len)
      } catch {
        /* ignore */
      }
    })

    const commit = (): void => {
      const next = el.value
      this.editing = false
      const pos = this.getPos()
      if (typeof pos === 'number' && next !== this.node.attrs.latex) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          latex: next
        })
        this.view.dispatch(tr)
      } else {
        this.render()
      }
    }

    const cancel = (): void => {
      this.editing = false
      this.render()
    }

    // The union type narrows addEventListener to the generic `Event`
    // signature; cast through HTMLElement to recover KeyboardEvent typing.
    const elAsEl = el as HTMLElement
    elAsEl.addEventListener('blur', commit)
    elAsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        el.blur()
      } else if (e.key === 'Enter' && !this.displayMode) {
        e.preventDefault()
        el.blur()
      }
    })
  }

  selectNode(): void {
    if (!this.editing) this.openEditor()
  }

  deselectNode(): void {
    if (this.editing && this.editor) this.editor.blur()
  }

  stopEvent(): boolean {
    return this.editing
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.editor = undefined
    this.unsubscribe?.()
    this.unsubscribe = null
  }
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
function injectEquationTags(latex: string, pos: number | undefined): string {
  if (typeof pos !== 'number') return latex
  const tags = getEquationNumbersForPos(pos)
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
function stripWrappers(latex: string, displayMode: boolean): string {
  if (!displayMode) return latex
  const dm = /^\s*\\\[([\s\S]*?)\\\]\s*$/.exec(latex)
  if (dm) return dm[1].trim()
  return latex
}

export const mathNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, false)

export const mathBlockNodeView: NodeViewConstructor = (node, view, getPos) =>
  new MathView(node, view, getPos, true)
