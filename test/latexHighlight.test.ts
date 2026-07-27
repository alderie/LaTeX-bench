import { describe, it, expect } from 'vitest'
import {
  paintLatex,
  tokenizeLatex
} from '@renderer/editor/wysiwyg/editors/latex-highlight'

// The highlighter sits *behind* a textarea the author is typing into, so its
// one hard requirement is that it reproduces the source exactly: a token that
// swallows a character shifts every glyph after it, and the colour slides off
// the text. The colours themselves are secondary.

const kinds = (source: string): string[] => tokenizeLatex(source).map((t) => t.kind)

const text = (source: string): string =>
  tokenizeLatex(source)
    .map((token) => source.slice(token.from, token.to))
    .join('')

describe('the LaTeX tokenizer', () => {
  it('accounts for every character of the source', () => {
    const source = '\\begin{align}\n  a &= b \\\\ % why\n  c &= \\frac{1}{2}\n\\end{align}'
    expect(text(source)).toBe(source)
  })

  it('leaves no gaps between tokens', () => {
    const source = 'x^2 + \\alpha_{i} = 3.5 & $y$'
    let at = 0
    for (const token of tokenizeLatex(source)) {
      expect(token.from).toBe(at)
      at = token.to
    }
    expect(at).toBe(source.length)
  })

  it('names the environment in a \\begin', () => {
    expect(kinds('\\begin{pmatrix}')).toEqual(['command', 'brace', 'env', 'brace'])
  })

  it('reads \\\\ as a row break, not as a macro', () => {
    // `\\alpha` is a row break followed by the letters "alpha" — colouring it
    // as a macro would say the author had written something they hadn't.
    expect(kinds('\\\\alpha')).toEqual(['separator', 'text'])
  })

  it('takes an escape and the character it protects as one token', () => {
    // Otherwise `\&` reads as an alignment point and `\%` starts a comment.
    expect(kinds('a \\& b \\% c')).toEqual(['text', 'command', 'text', 'command', 'text'])
  })

  it('runs a comment to the end of its line and no further', () => {
    const tokens = tokenizeLatex('a % note\nb')
    const comment = tokens.find((t) => t.kind === 'comment')
    expect(comment).toBeDefined()
    expect('a % note\nb'.slice(comment!.from, comment!.to)).toBe('% note')
  })

  it('sees $$ as one delimiter rather than two', () => {
    expect(kinds('$$x$$')).toEqual(['math', 'text', 'math'])
  })

  it('paints spans that concatenate back to the source', () => {
    const source = '\\alpha & \\beta \\\\ % end'
    const host = document.createElement('pre')
    paintLatex(source, host)
    // The trailing sentinel keeps a final newline from collapsing the box.
    expect(host.textContent?.replace(/\u200b/g, '')).toBe(source)
    expect(host.querySelectorAll('.tok--command').length).toBe(2)
  })
})
