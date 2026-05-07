#!/usr/bin/env node
// Quick probe: does the schema accept theoremEnv inside section content?
// Reproduces what WysiwygEditor.tsx does — parse heavy-tail-paper, then
// dump the resulting doc structure (ignoring text inline) so we can see
// if theoremEnv survives into the doc tree.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const parserUrl = pathToFileURL(
  join(root, 'src/renderer/src/editor/wysiwyg/latex-to-doc.ts')
).href
const { parseLatexToDoc } = await import(parserUrl)

const tex = readFileSync(join(root, 'test/fixtures/heavy-tail-paper.tex'), 'utf-8')
const { doc } = await parseLatexToDoc(tex)

// Walk the doc, dump each block-level node's type and (where present)
// kind/title/label so we can see whether theorems/bibliography landed
// in the doc tree at all.
function walk(node, depth = 0) {
  const indent = '  '.repeat(depth)
  const meta = []
  if (node.attrs?.kind) meta.push(`kind=${node.attrs.kind}`)
  if (node.attrs?.label) meta.push(`label=${node.attrs.label}`)
  if (node.attrs?.title) meta.push(`title=${node.attrs.title}`)
  if (node.attrs?.key) meta.push(`key=${node.attrs.key}`)
  if (node.attrs?.level) meta.push(`level=${node.attrs.level}`)
  console.log(`${indent}${node.type.name}${meta.length ? ' ' + meta.join(' ') : ''}`)
  node.forEach((child) => {
    if (child.isText) return
    if (['mathInline', 'mathBlock', 'citation', 'crossRef'].includes(child.type.name)) return
    walk(child, depth + 1)
  })
}

walk(doc)

// Now serialize and check the doc structurally validates against the schema.
// `doc.check()` throws when content rules are violated.
try {
  doc.check()
  console.log('\n✓ doc.check() passed — schema accepts the parsed structure')
} catch (err) {
  console.log('\n✗ doc.check() FAILED:', err.message)
}
