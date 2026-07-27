#!/usr/bin/env node
/**
 * Fidelity report for every fixture in test/fixtures/.
 *
 *   npm run fidelity            # summary table
 *   npm run fidelity -- --diff  # plus a unified diff per fixture
 *   npm run fidelity -- math.tex --diff
 *
 * The vitest suites assert specific behaviours. This script answers the
 * blunter question the suites can't: *how much of the document is the
 * editor still failing to understand?* It reports, per fixture:
 *
 *   stable      parse → serialize → parse → serialize is a fixed point.
 *               When this is false, every keystroke rewrites the file a
 *               little more, and the drift compounds.
 *   opaque      share of body blocks that landed in a `rawLatex` escape
 *               hatch instead of a modelled node. Lower is better: raw
 *               blocks aren't editable as prose and don't get numbered.
 *   leaked      inline atoms rendering as a literal backslash-macro —
 *               the WYSIWYG view showing `\c` where a `ç` belongs.
 *   changed     lines that differ between the input and one round-trip.
 *               Never zero (the serializer reflows paragraphs), but a
 *               jump means something started rewriting content.
 *
 * Exits non-zero if any fixture fails to reach a fixed point, so it can be
 * wired into CI as a regression gate.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const fixturesDir = join(root, 'test/fixtures')

const args = process.argv.slice(2)
const showDiff = args.includes('--diff')
const only = args.filter((a) => !a.startsWith('--'))

const { parseLatexToDoc } = await import(
  pathToFileURL(join(root, 'src/renderer/src/editor/wysiwyg/latex-to-doc.ts')).href
)
const { serializeDocToLatex } = await import(
  pathToFileURL(join(root, 'src/renderer/src/editor/wysiwyg/doc-to-latex.ts')).href
)

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.tex'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort()

function countNodes(doc) {
  const counts = new Map()
  let leaked = 0
  doc.descendants((node) => {
    if (node.isText) return false
    counts.set(node.type.name, (counts.get(node.type.name) ?? 0) + 1)
    // A rawInline whose visible text is its own source is a macro the
    // editor couldn't interpret — the user sees `\c` in their prose.
    if (node.type.name === 'rawInline') {
      const display = node.attrs.display ?? ''
      const source = node.attrs.source ?? ''
      // `\verb|…|` is *supposed* to show its literal body, backslash and
      // all — that's not the editor failing to understand a macro.
      if (display.startsWith('\\') && !source.startsWith('\\verb')) leaked += 1
    }
    return true
  })
  return { counts, leaked }
}

// Minimal LCS-based line diff — enough for a readable report without
// pulling in a dependency.
function diffLines(a, b) {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length
  // Guard against quadratic blowup on large files.
  if (n * m > 4_000_000) return { changed: Math.abs(n - m), hunks: [] }
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const hunks = []
  let i = 0
  let j = 0
  let changed = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      hunks.push(['  ', A[i]])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      hunks.push(['- ', A[i++]])
      changed++
    } else {
      hunks.push(['+ ', B[j++]])
      changed++
    }
  }
  while (i < n) {
    hunks.push(['- ', A[i++]])
    changed++
  }
  while (j < m) {
    hunks.push(['+ ', B[j++]])
    changed++
  }
  return { changed, hunks }
}

const rows = []
let anyUnstable = false

for (const name of fixtures) {
  const source = readFileSync(join(fixturesDir, name), 'utf-8')
  let row
  try {
    const { doc } = await parseLatexToDoc(source)
    const once = serializeDocToLatex(doc)
    const { doc: doc2 } = await parseLatexToDoc(once)
    const twice = serializeDocToLatex(doc2)

    const { counts, leaked } = countNodes(doc)
    const raw = counts.get('rawLatex') ?? 0
    const blocks = [...counts.entries()]
      .filter(([k]) => k !== 'text' && k !== 'preamble')
      .reduce((sum, [, v]) => sum + v, 0)
    const { changed } = diffLines(source, once)

    row = {
      name,
      stable: twice === once,
      opaque: blocks > 0 ? raw / blocks : 0,
      leaked,
      changed,
      lines: source.split('\n').length,
      source,
      once
    }
  } catch (err) {
    row = { name, error: err instanceof Error ? err.message : String(err) }
  }
  if (row.error || !row.stable) anyUnstable = true
  rows.push(row)
}

const pad = (s, n) => String(s).padEnd(n)
const padStart = (s, n) => String(s).padStart(n)
const width = Math.max(...rows.map((r) => r.name.length), 8)

console.log('')
console.log(
  `${pad('fixture', width)}  ${padStart('lines', 5)}  ${padStart('stable', 6)}  ${padStart('opaque', 6)}  ${padStart('leaked', 6)}  ${padStart('changed', 7)}`
)
console.log('-'.repeat(width + 40))
for (const r of rows) {
  if (r.error) {
    console.log(`${pad(r.name, width)}  ${padStart('ERROR', 5)}  ${r.error}`)
    continue
  }
  console.log(
    `${pad(r.name, width)}  ${padStart(r.lines, 5)}  ${padStart(r.stable ? 'yes' : 'NO', 6)}  ` +
      `${padStart(`${Math.round(r.opaque * 100)}%`, 6)}  ${padStart(r.leaked, 6)}  ${padStart(r.changed, 7)}`
  )
}
console.log('')

if (showDiff) {
  for (const r of rows) {
    if (r.error) continue
    const { hunks } = diffLines(r.source, r.once)
    const interesting = hunks.some(([tag]) => tag !== '  ')
    if (!interesting) continue
    console.log(`\n${'='.repeat(70)}\n${r.name}\n${'='.repeat(70)}`)
    for (const [tag, line] of hunks) {
      if (tag === '  ') continue
      console.log(tag + line)
    }
  }
}

process.exit(anyUnstable ? 1 : 0)
