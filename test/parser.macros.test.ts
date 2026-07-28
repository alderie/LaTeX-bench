import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import {
  preambleForSignatures,
  signaturesFromPreamble
} from '@renderer/editor/wysiwyg/latex-signatures'
import { allOfType } from './helpers'

// Macros the editor has no model for, used in text.
//
// Every case here corrupted the user's file on save before it was written
// down: the macro name deleted, its arguments stripped of their braces and
// run together into an undefined control sequence, or its optional argument
// moved to the wrong side. The rich view rewrites the whole `.tex` on every
// transaction, so "the editor renders it oddly" and "the editor destroys it"
// are the same event.

async function roundtrip(body: string, preamble = ''): Promise<string> {
  const tex = `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`
  const { doc } = await parseLatexToDoc(tex)
  return serializeDocToLatex(doc)
}

describe('a macro with no signature anywhere', () => {
  it('keeps one argument attached', async () => {
    expect(await roundtrip('Text \\mymacro{a} more.')).toContain('\\mymacro{a} more.')
  })

  it('keeps several arguments attached', async () => {
    // The old output was `\mymacroab` — an undefined control sequence.
    expect(await roundtrip('Text \\mymacro{a}{b} more.')).toContain('\\mymacro{a}{b} more.')
  })

  it('keeps an optional argument on the correct side', async () => {
    // The old output was `\mymacroa[opt]`: braces gone and the arguments
    // swapped, because `[opt]` arrives as three loose string nodes.
    expect(await roundtrip('Text \\mymacro[opt]{a} more.')).toContain('\\mymacro[opt]{a} more.')
  })

  it('keeps an empty argument', async () => {
    expect(await roundtrip('Text \\mymacro{} more.')).toContain('\\mymacro{} more.')
  })

  it('does not swallow a group that is merely nearby', async () => {
    // A space means the brace group is prose, not an argument. Absorbing
    // it would change what the document says.
    const out = await roundtrip('Text \\mymacro {group} more.')
    expect(out).not.toContain('\\mymacro{group}')
  })

  it('shows the last argument, which is where the visible text usually is', async () => {
    const { doc } = await parseLatexToDoc(
      '\\documentclass{article}\n\\begin{document}\n\\Colorhref[red]{https://x}{label}\n\\end{document}'
    )
    const raw = allOfType(doc, 'rawInline').find((n) =>
      (n.attrs.source as string).startsWith('\\Colorhref')
    )
    expect(raw?.attrs.display).toBe('label')
  })
})

describe('a macro the document itself declares', () => {
  const DECL = '\\newcommand{\\pair}[2]{\\ensuremath{\\langle #1, #2 \\rangle}}'

  it('round trips when the declaration is found', async () => {
    expect(await roundtrip('A \\pair{a}{b} B.', DECL)).toContain('\\pair{a}{b} B.')
  })

  it('round trips when a preamble comment mentions \\begin{document}', async () => {
    // The signature scan ended the preamble at the first `\begin{document}`
    // it saw — including one inside a comment. "% define macros before
    // \begin{document}" is advice people write, and it made every macro
    // below it invisible, so every use of one was corrupted on save.
    const preamble = `% put your macros before \\begin{document}\n${DECL}`
    expect(await roundtrip('A \\pair{a}{b} B.', preamble)).toContain('\\pair{a}{b} B.')
  })

  it('round trips an optional-argument declaration', async () => {
    const decl = '\\newcommand{\\todo}[2][red]{\\textcolor{#1}{#2}}'
    expect(await roundtrip('X \\todo[blue]{fix} Y.', decl)).toContain('\\todo[blue]{fix}')
    expect(await roundtrip('X \\todo{fix} Y.', decl)).toContain('\\todo{fix}')
  })
})

describe('preambleForSignatures', () => {
  it('ends the preamble at the real \\begin{document}', () => {
    const out = preambleForSignatures('\\newcommand{\\a}[1]{#1}\n\\begin{document}\nbody\n')
    expect(out).toContain('\\newcommand')
    expect(out).not.toContain('body')
  })

  it('is not ended by a commented-out \\begin{document}', () => {
    const out = preambleForSignatures(
      '% see \\begin{document}\n\\newcommand{\\a}[1]{#1}\n\\begin{document}\nbody\n'
    )
    expect(out).toContain('\\newcommand')
    expect(out).not.toContain('body')
  })

  it('does not read a declaration that is commented out', () => {
    const sigs = signaturesFromPreamble(
      '% \\newcommand{\\ghost}[2]{x}\n\\newcommand{\\real}[1]{y}\n\\begin{document}\n'
    )
    expect(sigs.ghost).toBeUndefined()
    expect(sigs.real).toEqual({ signature: 'm' })
  })

  it('treats an escaped percent as content, not a comment', () => {
    const sigs = signaturesFromPreamble('100\\% \\newcommand{\\real}[1]{y}\n\\begin{document}\n')
    expect(sigs.real).toEqual({ signature: 'm' })
  })

  it('reads an optional first argument as optional', () => {
    const sigs = signaturesFromPreamble('\\newcommand{\\todo}[2][red]{x}\n\\begin{document}\n')
    expect(sigs.todo).toEqual({ signature: 'o m' })
  })
})

describe('standalone accents', () => {
  // `\~{}` is how LaTeX writes a bare tilde accent. `applyAccent` returned
  // null for an empty argument, the macro fell through to a path that
  // dropped it, and the character disappeared from the document.
  const CASES: Array<[string, string]> = [
    ['\\~{}', '˜'],
    ['\\^{}', 'ˆ'],
    ['\\"{}', '¨'],
    ["\\'{}", '´'],
    ['\\={}', '¯'],
    ['\\.{}', '˙'],
    ['\\v{}', 'ˇ'],
    ['\\c{}', '¸']
  ]

  for (const [source, glyph] of CASES) {
    it(`${source} survives and stands for ${glyph}`, async () => {
      const out = await roundtrip(`A ${source} B.`)
      expect(out).toContain(source)
    })
  }

  it('still composes an accent that has an argument', async () => {
    expect(await roundtrip('Caf\\\'{e} and na\\"{\\i}ve.')).toContain("\\'{e}")
  })

  it('does not leave a gap where the accent was', async () => {
    const out = await roundtrip('tilde \\~{} and caret \\^{}.')
    expect(out).not.toContain('tilde  and')
  })
})

describe('empty groups', () => {
  it('keeps a standalone {} in prose', async () => {
    // `{}` stops a following `[` being read as an optional argument and
    // keeps characters out of a ligature. Dropped, it also left a double
    // space that the next save collapsed — so the file drifted on its own.
    expect(await roundtrip('An empty group {} here.')).toContain('{} here.')
  })

  it('does not double the spacing guard after a macro', async () => {
    // `\TeX{}` already writes its own `{}`; preserving the group as well
    // would come back as `\TeX{}{}`.
    const out = await roundtrip('The \\TeX{}book is a book.')
    expect(out).not.toContain('{}{}')
  })
})

describe('control words never fuse with what follows', () => {
  // `\TeX` and `book` written adjacently are not a macro and a word — they
  // are `\TeXbook`, one undefined control sequence, and the build stops.
  // Real LaTeX caught this one; no structural check would have.
  it('keeps \\TeX{}book from becoming \\TeXbook', async () => {
    const out = await roundtrip('The \\TeX{}book is a book.')
    expect(out).toContain('\\TeX{}book')
    expect(out).not.toContain('\\TeXbook')
  })

  it('keeps a following space from being eaten', async () => {
    const out = await roundtrip('Written in \\LaTeX{} today.')
    expect(out).toMatch(/\\LaTeX\{\}\s*today/)
  })

  it('needs no guard before punctuation', async () => {
    // A comma cannot extend a control word, so `\LaTeX,` is already
    // unambiguous — with or without the group, it typesets the same.
    const out = await roundtrip('Written in \\LaTeX{}, today.')
    expect(out).toMatch(/\\LaTeX(\{\})?,/)
  })
})
