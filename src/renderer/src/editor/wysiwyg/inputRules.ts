import { InputRule } from 'prosemirror-inputrules'
import { latexSchema } from './schema'

// Inline math: a closing $ that follows ...$<latex>$ replaces the run with
// a mathInline atom node carrying the latex source.
export const mathInlineInputRule = new InputRule(/(?:^|[^\\])\$([^$\n]+)\$$/, (state, match, _start, end) => {
  const [, expr] = match
  const tr = state.tr
  // The capture group covers content between the dollar signs; the full
  // match also includes the leading non-backslash char (or BOL). Adjust the
  // start so we delete the entire `$...$` run.
  const matchText = match[0]
  const dollarIdx = matchText.lastIndexOf('$', matchText.length - 2)
  const replaceFrom = end - (matchText.length - dollarIdx) + 1
  const node = latexSchema.nodes.mathInline.create({ latex: expr.trim() })
  tr.replaceWith(replaceFrom, end, node)
  return tr
})

// Block math: a line consisting of `$$<latex>$$` (or `$$$$` empty) at the
// start of an empty paragraph swaps the paragraph for a mathBlock.
export const mathBlockInputRule = new InputRule(/^\$\$([^$]*)\$\$$/, (state, match, start, _end) => {
  const expr = (match[1] ?? '').trim()
  const tr = state.tr
  const $start = state.doc.resolve(start)
  // Replace the entire enclosing paragraph with a math block.
  const block = latexSchema.nodes.mathBlock.create({
    latex: `\\[${expr}\\]`,
    label: null
  })
  const paraStart = $start.before($start.depth)
  const paraEnd = $start.after($start.depth)
  tr.replaceWith(paraStart, paraEnd, block)
  return tr
})
