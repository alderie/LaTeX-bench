import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { allOfType, fixture, firstOfType, flatText } from './helpers'

// Stress test: a fake research paper that exercises a wide surface area of
// real-world LaTeX (theorem-like envs, algorithm/algorithmic, tikzpicture,
// lstlisting, booktabs table, cleveref/natbib citations, custom \newcommand
// macros, thebibliography, appendix, …). The tests document what the parser
// currently surfaces vs. preserves verbatim, so regressions are caught.

describe('parser — heavy-tail paper (broad LaTeX surface)', () => {
  it('parses without throwing', async () => {
    await expect(parseLatexToDoc(fixture('heavy-tail-paper.tex'))).resolves.toBeDefined()
  })

  it('captures all sections', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const sections = allOfType(doc, 'section')
    const titles = sections.map((s) => {
      const t = firstOfType(s, 'sectionTitle')
      return t ? flatText(t).trim() : ''
    })
    // Numbered sections + appendix \section + \section* (Acknowledgments)
    expect(titles).toContain('Introduction')
    expect(titles).toContain('Preliminaries')
    expect(titles).toContain('Main Results')
    expect(titles).toContain('Numerical Experiments')
    expect(titles).toContain('Discussion')
    expect(titles).toContain('Acknowledgments')
    expect(titles).toContain('Deferred Proofs')
  })

  it('captures subsections nested inside their parent section', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const sections = allOfType(doc, 'section')
    const subTitles = sections
      .filter((s) => s.attrs.level === 2)
      .map((s) => {
        const t = firstOfType(s, 'sectionTitle')
        return t ? flatText(t).trim() : ''
      })
    expect(subTitles).toContain('Geometry of the dual update')
    expect(subTitles).toContain('Heavy-tailed linear regression')
    expect(subTitles).toContain('Convergence diagnostics')
    expect(subTitles).toContain('A note on hyperparameters')
    expect(subTitles).toContain('An auxiliary tail bound')
  })

  it('extracts equation/align/gather as math blocks at top level', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const blocks = allOfType(doc, 'mathBlock')
    const sources = blocks.map((b) => b.attrs.latex as string)
    // Math envs at the top level surface as math blocks. (\begin{align} is
    // intentionally nested inside a \begin{proof} env in this fixture and
    // therefore stays inside the proof's opaque rawLatex source — that's the
    // current contract: nested math in unknown envs is preserved verbatim.)
    expect(sources.some((s) => s.startsWith('\\begin{equation}'))).toBe(true)
    expect(sources.some((s) => s.startsWith('\\begin{equation*}'))).toBe(true)
    expect(sources.some((s) => s.startsWith('\\begin{align*}'))).toBe(true)
    expect(sources.some((s) => s.startsWith('\\begin{gather}'))).toBe(true)
    expect(blocks.length).toBeGreaterThanOrEqual(6)
  })

  it('extracts inline math from prose paragraphs', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const inlines = allOfType(doc, 'mathInline')
    expect(inlines.length).toBeGreaterThan(20) // there's a lot of inline math
    const allLatex = inlines.map((n) => n.attrs.latex as string).join(' ')
    expect(allLatex).toContain('\\R^d')
    expect(allLatex).toContain('\\sigma')
  })

  it('captures truly unknown environments as byte-exact rawLatex blocks', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const raws = allOfType(doc, 'rawLatex').map((n) => (n.attrs.source as string).trim())
    const joined = raws.join('\n\n--\n\n')
    // algorithmic / tabular / tikzpicture have no first-class node, so they
    // stay raw — but with their environment arguments and internal line
    // breaks intact, which is what the tabular renderer needs to lay out
    // columns and what a round-trip needs to not rewrite the file.
    expect(joined).toMatch(/\\begin\{algorithmic\}\[1\]/)
    expect(joined).toMatch(/\\begin\{tabular\}\{lccc\}/)
    expect(joined).toMatch(/\\begin\{tikzpicture\}\[scale=0\.95\]/)
    expect(joined).toContain('\\toprule\n')
  })

  it('promotes float environments (table, algorithm) to floatBlock nodes', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const floats = allOfType(doc, 'floatBlock')
    const byKind = new Map(floats.map((f) => [f.attrs.kind as string, f]))
    // `abstract` is a layout-only container but uses the same node, so its
    // \begin/\end survives a save instead of being silently deleted.
    expect([...byKind.keys()].sort()).toEqual(['abstract', 'algorithm', 'figure', 'table'])

    const algorithm = byKind.get('algorithm')!
    expect(algorithm.attrs.label).toBe('alg:cmd')
    expect(algorithm.attrs.args).toBe('[t]')
    expect(flatText(firstOfType(algorithm, 'caption')!)).toBe('Clipped Mirror Descent (CMD)')

    const table = byKind.get('table')!
    expect(table.attrs.label).toBe('tab:regression')
    expect(table.attrs.centering).toBe(true)
    // A caption with inline math keeps the math as a real node.
    const caption = firstOfType(table, 'caption')!
    expect(allOfType(caption, 'mathInline').length).toBe(1)

    // The tikzpicture figure is a float too — previously its body was
    // dropped on serialize because the atom `figure` node had nowhere to
    // put it.
    const fig = byKind.get('figure')!
    expect(fig.attrs.label).toBe('fig:convergence')
    const rawInFig = allOfType(fig, 'rawLatex').map((n) => n.attrs.source as string)
    expect(rawInFig.some((s) => s.includes('\\begin{tikzpicture}'))).toBe(true)
  })

  it('parses lstlisting into a codeBlock with its language', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const code = allOfType(doc, 'codeBlock')
    expect(code.length).toBe(1)
    expect(code[0].attrs.env).toBe('lstlisting')
    expect(code[0].attrs.language).toBe('Python')
    const body = code[0].attrs.code as string
    expect(body.startsWith('def cmd_step(')).toBe(true)
    expect(body).toContain('    g_norm = dual_norm(g)')
    // The \begin/\end delimiters are not part of the body.
    expect(body).not.toContain('lstlisting')
  })

  it('keeps \\verb content as literal text with its delimiter', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const verbs = allOfType(doc, 'rawInline').filter((n) =>
      (n.attrs.source as string).startsWith('\\verb')
    )
    expect(verbs.length).toBe(1)
    // TeX ends \verb at the FIRST repeat of the delimiter, so the fixture's
    // `\verb|… / ||g||)|` really does stop early — we match that rather
    // than guessing. What matters is that the body is preserved verbatim
    // instead of being re-parsed as LaTeX (which ate characters before).
    expect(verbs[0].attrs.display).toBe('g_hat = g * min(1, tau / ')
    expect(verbs[0].attrs.source).toBe('\\verb|g_hat = g * min(1, tau / |')
  })

  it('turns \\footnote and \\thanks into footnote nodes rather than inlining the body', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const notes = allOfType(doc, 'footnote')
    expect(notes.map((n) => n.attrs.cmd).sort()).toEqual(['footnote', 'thanks'])
    const thanks = notes.find((n) => n.attrs.cmd === 'thanks')!
    expect(thanks.attrs.source).toContain('Corresponding author')
    // The note body must not leak into the surrounding prose.
    const text = flatText(doc)
    expect(text).not.toContain('ReyesCorresponding author')
    expect(text).not.toContain('variance.A simple counterexample')
  })

  it('renders \\paragraph as a level-4 heading instead of running it into the prose', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const runIn = allOfType(doc, 'section').filter((s) => s.attrs.level === 4)
    const titles = runIn.map((s) => flatText(firstOfType(s, 'sectionTitle')!))
    expect(titles).toEqual(['Contributions.', 'Notation.', 'Limitations.'])
    expect(flatText(doc)).not.toContain('Contributions. This paper makes')
  })

  it('applies TeX dash ligatures across split string nodes', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const text = flatText(doc)
    // `---` and `--` arrive from unified-latex as separate one-character
    // string nodes, so a per-node replace never fired.
    expect(text).toContain('the inner update — in pseudocode')
    expect(text).not.toContain('---')
    expect(text).toContain('167–175')
  })

  it('does not emit an empty raw block for \\noindent', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const raws = allOfType(doc, 'rawLatex').map((n) => (n.attrs.source as string).trim())
    expect(raws).not.toContain('\\noindent')
    // …but it still round-trips, as an invisible inline node.
    const invisible = allOfType(doc, 'rawInline').filter((n) => n.attrs.display === '')
    expect(invisible.some((n) => n.attrs.source === '\\noindent')).toBe(true)
  })

  it('keeps enumitem list options and \\citep-style commands', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const lists = allOfType(doc, 'listBlock')
    const options = lists.map((l) => l.attrs.options as string)
    expect(options).toContain('label=(\\roman*)')
    expect(options).toContain('leftmargin=*')

    const cites = allOfType(doc, 'citation')
    const cmds = new Set(cites.map((c) => c.attrs.cmd as string))
    expect(cmds.has('citep')).toBe(true)
    expect(cmds.has('citet')).toBe(true)
  })

  it('promotes theorem-like envs to first-class theoremEnv blocks', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const theorems = allOfType(doc, 'theoremEnv')
    const kinds = theorems.map((t) => t.attrs.kind as string).sort()
    expect(kinds).toContain('theorem')
    expect(kinds).toContain('lemma')
    expect(kinds).toContain('definition')
    expect(kinds).toContain('example')
    expect(kinds).toContain('remark')
    expect(kinds).toContain('corollary')
    expect(kinds).toContain('proposition')
    expect(kinds).toContain('assumption')
    expect(kinds).toContain('proof')
    // Theorem labels (\label{thm:upper}) attach to the env attrs.
    const labels = theorems.map((t) => t.attrs.label).filter((x) => typeof x === 'string')
    expect(labels.some((l) => l === 'thm:upper')).toBe(true)
    // Optional `[title]` after \begin{kind}[...] is captured.
    const titles = theorems.map((t) => t.attrs.title).filter((x) => typeof x === 'string')
    expect(titles.some((t) => /Bounded.*moment/i.test(t as string))).toBe(true)
  })

  it('promotes thebibliography to a first-class node with editable bibitems', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const bibs = allOfType(doc, 'bibliography')
    expect(bibs.length).toBe(1)
    const items = allOfType(doc, 'bibitem')
    expect(items.length).toBeGreaterThanOrEqual(8)
    const keys = items.map((b) => b.attrs.key as string)
    expect(keys).toContain('beck2003mirror')
    expect(keys).toContain('cont2001empirical')
    expect(keys).toContain('nemirovski1983problem')
    // bibitem body is inline — first item should mention "Mirror descent".
    const firstBody = flatText(items[0])
    expect(firstBody).toMatch(/Mirror descent/i)
  })

  it('extracts preamble math macros for KaTeX', async () => {
    const result = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const m = result.mathMacros
    // \newcommand definitions
    expect(m['\\R']).toBe('\\mathbb{R}')
    expect(m['\\E']).toBe('\\mathbb{E}')
    expect(m['\\PP']).toBe('\\mathbb{P}')
    // 1-arg macros keep the body verbatim (KaTeX deduces argcount from #N).
    expect(m['\\norm']).toContain('#1')
    expect(m['\\inner']).toContain('#1')
    expect(m['\\inner']).toContain('#2')
    // \DeclareMathOperator → \operatorname{…}
    expect(m['\\Tr']).toBe('\\operatorname{Tr}')
    expect(m['\\KL']).toBe('\\operatorname{KL}')
    // starred form → \operatorname*
    expect(m['\\argmin']).toBe('\\operatorname*{arg\\,min}')
    // \label is NOT seeded here. MathNodeView defines it as a function
    // macro that consumes its `{key}` argument; seeding `''` made KaTeX
    // treat it as 0-arg and the key rendered as visible math ("eq:upper").
    expect(m['\\label']).toBeUndefined()
  })

  it('treats \\maketitle as a titleBlock and \\appendix as a rawLatex block', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const raws = allOfType(doc, 'rawLatex').map((n) => (n.attrs.source as string).trim())
    // \maketitle becomes a structured titleBlock built from preamble metadata.
    expect(allOfType(doc, 'titleBlock')).toHaveLength(1)
    expect(raws.some((s) => s === '\\appendix' || s.startsWith('\\appendix'))).toBe(true)
  })

  it('renders \\textbf / \\emph / \\texttt as marks, not raw text', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const marks: Record<string, string[]> = {}
    doc.descendants((n) => {
      if (n.isText) for (const m of n.marks) (marks[m.type.name] ??= []).push(n.text ?? '')
      return true
    })
    // The paper has \emph{clipped mirror descent} in the contributions list
    // and \texttt{reyes@example.edu} in the title \thanks.
    expect(marks.em ?? []).toContain('clipped mirror descent')
    expect(flatText(doc)).not.toContain('\\emph')
    expect(flatText(doc)).not.toContain('\\texttt')
  })

  it('does not leak macro names into prose for unhandled cleveref/natbib commands', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const text = flatText(doc)
    // \citep, \citet, \cref, \Cref, \eqref aren't all wired up to dedicated
    // nodes yet, but at minimum the macro NAMES shouldn't appear as visible
    // text — they should either become citation/crossRef nodes, surface
    // their visible-text arg, or be silently dropped.
    expect(text).not.toContain('\\citep')
    expect(text).not.toContain('\\citet')
    expect(text).not.toContain('\\cref')
    expect(text).not.toContain('\\Cref')
    expect(text).not.toContain('\\eqref')
  })

  it('keeps prose readable around the structural islands', async () => {
    const { doc } = await parseLatexToDoc(fixture('heavy-tail-paper.tex'))
    const text = flatText(doc)
    expect(text).toContain('Stochastic optimization under heavy-tailed noise')
    expect(text).toContain('We compare clipped mirror descent')
    expect(text).toContain('The analysis admits several extensions')
    expect(text).toContain('We thank the anonymous reviewers')
  })
})
