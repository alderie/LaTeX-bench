import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, copyFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import { serializeDocToLatex } from '@renderer/editor/wysiwyg/doc-to-latex'
import { parseLatexLog } from '../src/main/latex/log-parser'
import { fixture } from './helpers'

// Does the editor's output still compile?
//
// Every other test in this suite asks whether the output *looks* right. This
// one asks the only question that finally matters, by handing the file to
// LaTeX. It is how `\TeX{}book` was caught coming back as `\TeXbook` — a
// single missing empty group, invisible in a diff, fatal to the build, and
// passing every structural check we had.
//
// Skipped unless a LaTeX is on PATH (or `TEST_LATEX_BIN` points at one), so
// the suite still runs on a machine without a TeX distribution. Set
// `TEST_REQUIRE_LATEX=1` in CI to turn a missing engine into a failure
// rather than a silent skip.

const here = dirname(fileURLToPath(import.meta.url))

function findLatexmk(): string | null {
  const explicit = process.env.TEST_LATEX_BIN
  if (explicit) {
    const candidate = join(explicit, 'latexmk')
    if (existsSync(candidate)) return candidate
    if (existsSync(explicit)) return explicit
  }
  const which = spawnSync('which', ['latexmk'], { encoding: 'utf-8' })
  const found = which.stdout?.trim()
  return found && existsSync(found) ? found : null
}

const latexmk = findLatexmk()
const required = process.env.TEST_REQUIRE_LATEX === '1'

/**
 * Compile `tex` and return LaTeX's own errors.
 *
 * The errors come from the `.log` file, read with the same parser the app
 * uses to fill its build panel — not from latexmk's stdout, which is a
 * summary and carries none of them. Getting that wrong the first time gave
 * a check that passed on a document with an undefined control sequence in
 * it, which is why `the check can fail` exists below.
 */
function compile(latex: string, assets: string[] = []): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'corbato-compile-'))
  try {
    writeFileSync(join(dir, 'main.tex'), latex, 'utf-8')
    for (const asset of assets) {
      copyFileSync(join(here, 'fixtures', asset), join(dir, asset))
    }
    let threw = false
    try {
      execFileSync(
        latexmk!,
        ['-pdf', '-interaction=nonstopmode', '-file-line-error', '-outdir=.build', 'main.tex'],
        {
          cwd: dir,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 300_000,
          // latexmk shells out to `pdflatex` and `bibtex` by name, so an
          // absolute path to latexmk alone is not enough — its children
          // have to resolve to the same installation. The app's compiler
          // does this for the same reason.
          env: { ...process.env, PATH: `${dirname(latexmk!)}:${process.env.PATH ?? ''}` }
        }
      )
    } catch {
      threw = true
    }

    const logPath = join(dir, '.build', 'main.log')
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : ''
    const errors = parseLatexLog(log)
      .filter((e) => e.severity === 'error')
      .map((e) => `${e.file ? `${e.file}:${e.line}: ` : ''}${e.message}`)

    if (errors.length > 0) return errors.slice(0, 10)
    // A run that failed without a parseable error still failed.
    if (threw && !existsSync(join(dir, '.build', 'main.pdf'))) {
      return ['latexmk failed and produced no PDF']
    }
    return []
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

beforeAll(() => {
  if (required && !latexmk) {
    throw new Error('TEST_REQUIRE_LATEX=1 but no latexmk was found on PATH')
  }
})

describe.skipIf(!latexmk)('the editor’s output compiles', () => {
  const CASES: Array<{ name: string; assets: string[] }> = [
    { name: 'torture.tex', assets: ['torture-figure.pdf'] },
    { name: 'heavy-tail-paper.tex', assets: [] },
    { name: 'kitchen-sink.tex', assets: [] }
  ]

  for (const { name, assets } of CASES) {
    it(`${name} — a round trip does not break the build`, async () => {
      // Comparative on purpose. Asserting "the output compiles" outright
      // would fail on any machine missing a package the fixture loads —
      // which is most of them, and none of it the editor's doing. The
      // invariant that matters is that the editor cannot turn a document
      // that compiled into one that doesn't.
      const source = fixture(name)
      const before = compile(source, assets)
      if (before.length > 0) {
        // Nothing to compare against; say why rather than passing quietly.
        console.warn(`[compile] skipping ${name}: it does not compile here — ${before[0]}`)
        return
      }
      const { doc } = await parseLatexToDoc(source)
      expect(compile(serializeDocToLatex(doc), assets)).toEqual([])
    })
  }
})

describe.skipIf(!latexmk)('the compile check itself', () => {
  it('can fail', () => {
    // The first version of this filtered latexmk's stdout, which carries a
    // summary and none of the errors — so it passed on anything at all.
    const broken =
      '\\documentclass{article}\n\\begin{document}\n\\undefinedmacro\n\\end{document}\n'
    expect(compile(broken).length).toBeGreaterThan(0)
  })

  it('passes a document that is fine', () => {
    const fine = '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n'
    expect(compile(fine)).toEqual([])
  })
})

describe.skipIf(latexmk)('the compile check', () => {
  it('is skipped, and says so', () => {
    // Present so a run without LaTeX reports why the checks above are
    // missing rather than silently having none.
    expect(latexmk).toBeNull()
  })
})
