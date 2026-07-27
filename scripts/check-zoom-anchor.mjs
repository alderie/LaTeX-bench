#!/usr/bin/env node
/**
 * Verify anchored zoom against a real layout engine.
 *
 *   npm run check:zoom
 *
 * The vitest suite pins the arithmetic with hand-supplied geometry, which
 * jsdom cannot provide. The claim that actually matters to a reader — "the
 * line under my cursor stays where it is when I zoom" — can only be checked
 * somewhere that does real layout, so this drives headless Chromium.
 *
 * It builds a page with the paper's real metrics (a `ch`-based measure that
 * scales with zoom, fixed pixel padding that does not), scrolls deep into a
 * long document, zooms at a point, and measures how far the text under that
 * point moved. Exits non-zero if the drift exceeds a couple of pixels.
 *
 * Reports the same measurement with anchoring disabled, so the number the
 * fix is worth is visible rather than asserted.
 *
 * Playwright is imported lazily and is NOT a dependency of this project —
 * a headless browser is a lot of install weight to carry for one check.
 * Run `npm i -D playwright` first if you want to use it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const anchorModule = readFileSync(
  join(root, 'src/renderer/src/editor/zoom-anchor.ts'),
  'utf-8'
)

// Strip the TypeScript that Chromium can't run. The module is deliberately
// plain — types on the edges, no syntax that survives only under a compiler
// — so this is a matter of removing annotations, not transpiling.
function stripTypes(source) {
  return source
    .replace(/^import[\s\S]*?from '.*?'\n/gm, '')
    .replace(/^export interface [\s\S]*?\n}\n/gm, '')
    .replace(/^interface [\s\S]*?\n}\n/gm, '')
    .replace(/\bexport\s+/g, '')
    .replace(/: AnchorPoint \| null/g, '')
    .replace(/: CapturedAnchor \| null/g, '')
    .replace(/: HTMLElement \| null/g, '')
    .replace(/: Element \| null/g, '')
    .replace(/: Document \| HTMLElement = document/g, ' = document')
    .replace(/: AnchorPoint/g, '')
    .replace(/: CapturedAnchor/g, '')
    .replace(/: HTMLElement/g, '')
    .replace(/: Element/g, '')
    .replace(/: number/g, '')
    .replace(/: string/g, '')
    .replace(/: void/g, '')
}

const PARAGRAPHS = 120

const page = `
<style>
  html, body { margin: 0; height: 100%; }
  :root { --paper-zoom: 1; --paper-measure: 86ch; --paper-body-size: 18px; --paper-margin-y: 96px; }
  .wysiwyg-editor {
    height: 100vh; overflow-y: auto; display: flex; justify-content: center;
    background: #fbfaf8;
  }
  .ProseMirror {
    /* The metrics that make this non-trivial: a measure that scales with
       zoom, and padding that does not. */
    font-size: calc(var(--paper-body-size) * var(--paper-zoom));
    width: var(--paper-measure);
    max-width: 100%;
    padding: var(--paper-margin-y) 24px 40vh 24px;
    font-family: Georgia, serif;
    line-height: 1.6;
  }
  p { margin: 0 0 0.9em 0; text-align: justify; }
  .tall { height: 6em; background: #eee; margin: 1em 0; }
</style>
<div class="wysiwyg-editor">
  <div class="ProseMirror">
    ${Array.from({ length: PARAGRAPHS }, (_, i) =>
      i % 9 === 8
        ? `<div class="tall" data-i="${i}">block ${i}</div>`
        : `<p data-i="${i}">Paragraph ${i}. The quick brown fox jumps over the lazy dog, and
           keeps on jumping for long enough that this paragraph wraps across
           several lines at the paper's natural measure.</p>`
    ).join('\n')}
  </div>
</div>
`

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error(
    'This check drives headless Chromium and needs Playwright, which is not\n' +
      'a dependency of this project. Install it with:\n\n' +
      '  npm i -D playwright\n'
  )
  process.exit(2)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
})
const tab = await browser.newPage({ viewport: { width: 1100, height: 800 } })
await tab.setContent(page)
await tab.addScriptTag({ content: stripTypes(anchorModule) })

/**
 * Zoom at a point and report how far the text under it moved.
 * With `anchored: false` we skip the correction, which is the behaviour
 * being replaced.
 */
async function drift({ scrollTop, clientY, from, to, anchored }) {
  return tab.evaluate(
    ({ scrollTop, clientY, from, to, anchored }) => {
      const container = document.querySelector('.wysiwyg-editor')
      document.documentElement.style.setProperty('--paper-zoom', String(from))
      container.scrollTop = scrollTop
      // Force layout so the starting state is settled.
      void container.scrollHeight

      const probe = document.elementFromPoint(550, clientY)
      const before = probe.getBoundingClientRect()
      const offsetInProbe = before.height > 0 ? (clientY - before.top) / before.height : 0

      const captured = anchored ? captureAnchor(container, { clientX: 550, clientY }) : null
      document.documentElement.style.setProperty('--paper-zoom', String(to))
      if (anchored) restoreAnchor(captured)

      const after = probe.getBoundingClientRect()
      const nowAt = after.top + offsetInProbe * after.height
      return { drift: Math.abs(nowAt - clientY), label: probe.dataset.i }
    },
    { scrollTop, clientY, from, to, anchored }
  )
}

const CASES = [
  { name: 'zoom in, near the top', scrollTop: 200, clientY: 300, from: 1, to: 1.5 },
  { name: 'zoom in, deep in the paper', scrollTop: 6000, clientY: 400, from: 1, to: 1.5 },
  { name: 'zoom out, deep in the paper', scrollTop: 6000, clientY: 400, from: 1.5, to: 1 },
  { name: 'small step, deep in the paper', scrollTop: 8000, clientY: 650, from: 1, to: 1.1 },
  { name: 'large step, very deep', scrollTop: 12000, clientY: 200, from: 0.75, to: 2 }
]

const TOLERANCE_PX = 2

let failures = 0
console.log('')
console.log(`${'case'.padEnd(30)} ${'anchored'.padStart(9)} ${'unanchored'.padStart(11)}`)
console.log('-'.repeat(54))

for (const testCase of CASES) {
  const anchored = await drift({ ...testCase, anchored: true })
  const plain = await drift({ ...testCase, anchored: false })
  const ok = anchored.drift <= TOLERANCE_PX
  if (!ok) failures++
  console.log(
    `${testCase.name.padEnd(30)} ${`${anchored.drift.toFixed(1)}px`.padStart(9)} ` +
      `${`${plain.drift.toFixed(0)}px`.padStart(11)}  ${ok ? '' : '← FAILED'}`
  )
}

console.log('')
console.log(
  failures === 0
    ? `All cases hold position within ${TOLERANCE_PX}px.`
    : `${failures} case(s) drifted more than ${TOLERANCE_PX}px.`
)

await browser.close()
process.exit(failures === 0 ? 0 : 1)
