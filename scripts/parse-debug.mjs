#!/usr/bin/env node
// Quick-and-dirty CLI for inspecting how the parser handles a .tex file.
//
//   npm run parse:debug -- test/fixtures/moderncv-cv.tex
//   npm run parse:debug -- test/fixtures/math.tex --outline
//   npm run parse:debug -- test/fixtures/minimal.tex --json
//
// Defaults to printing a node outline. Pass `--json` for the raw doc, or
// `--roundtrip` to see the serialized LaTeX from a parse → serialize pass.
//
// This script imports the parser as ESM directly from the source — it
// does NOT need a build. We resolve the ts files via tsx-style hooks
// won't work cross-platform, so instead this script uses the build
// output (`out/...`) when present, else falls back to running parser
// pieces inlined here. To avoid the build step, we just shell out to
// vitest's snapshot mode in CI; this script is for local one-offs.
//
// To keep things simple this script runs through tsx via npm:
//   node --import tsx scripts/parse-debug.mjs <file>

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help')) {
  console.error(`
parse-debug — inspect parser output for a .tex fixture.

Usage:
  node --import tsx scripts/parse-debug.mjs <file.tex> [--outline | --json | --roundtrip]

Examples:
  node --import tsx scripts/parse-debug.mjs test/fixtures/math.tex --outline
  node --import tsx scripts/parse-debug.mjs test/fixtures/moderncv-cv.tex --json | jq .
`)
  process.exit(args.length === 0 ? 1 : 0)
}

const file = args.find((a) => !a.startsWith('--'))
const mode =
  args.includes('--json')      ? 'json'
  : args.includes('--roundtrip') ? 'roundtrip'
  : 'outline'

if (!file) {
  console.error('No file argument')
  process.exit(1)
}

const tex = readFileSync(resolve(file), 'utf-8')

// Dynamic-import the parser module from source. This works under
// `node --import tsx`, which transpiles the .ts on the fly.
const parserUrl = pathToFileURL(
  resolve(root, 'src/renderer/src/editor/wysiwyg/latex-to-doc.ts')
).href
const serializerUrl = pathToFileURL(
  resolve(root, 'src/renderer/src/editor/wysiwyg/doc-to-latex.ts')
).href

const { parseLatexToDoc } = await import(parserUrl)
const { serializeDocToLatex } = await import(serializerUrl)

const { doc, preamble, documentClass } = await parseLatexToDoc(tex)

if (mode === 'json') {
  console.log(JSON.stringify(doc.toJSON(), null, 2))
} else if (mode === 'roundtrip') {
  console.log(serializeDocToLatex(doc))
} else {
  console.log(`documentClass: ${documentClass}`)
  console.log(`preamble (${preamble.split('\n').length} lines):`)
  console.log(preamble.split('\n').slice(0, 5).map((l) => '  ' + l).join('\n'))
  if (preamble.split('\n').length > 5) console.log('  …')
  console.log('')
  console.log('document outline:')
  printOutline(doc, 0)
}

function printOutline(node, depth) {
  const indent = '  '.repeat(depth)
  const attrs = summarizeAttrs(node)
  if (node.isText) {
    const txt = (node.text ?? '').slice(0, 60)
    const marks = node.marks.map((m) => m.type.name).join(',')
    console.log(`${indent}text${marks ? ' [' + marks + ']' : ''} ${JSON.stringify(txt)}`)
    return
  }
  console.log(`${indent}${node.type.name}${attrs}`)
  node.forEach((child) => printOutline(child, depth + 1))
}

function summarizeAttrs(node) {
  const a = node.attrs ?? {}
  const interesting = {}
  for (const k of ['level', 'env', 'kind', 'src', 'href', 'label', 'keys']) {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') interesting[k] = a[k]
  }
  if (a.latex && typeof a.latex === 'string') {
    interesting.latex = a.latex.replace(/\s+/g, ' ').slice(0, 50) + (a.latex.length > 50 ? '…' : '')
  }
  if (a.source && typeof a.source === 'string') {
    interesting.source = a.source.replace(/\s+/g, ' ').slice(0, 50) + (a.source.length > 50 ? '…' : '')
  }
  const keys = Object.keys(interesting)
  if (keys.length === 0) return ''
  return ' { ' + keys.map((k) => `${k}=${JSON.stringify(interesting[k])}`).join(', ') + ' }'
}
