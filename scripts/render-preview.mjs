#!/usr/bin/env node
/**
 * Renders every fixture in test/fixtures/ to a static HTML page that
 * mimics the WYSIWYG view, then writes them to preview/. Open
 * preview/index.html in a browser to eyeball how the parser handles
 * each fixture without launching the Electron app.
 *
 * Run with:
 *   npm run preview
 *
 * Why this exists: vitest tests assert *structure* (node types,
 * counts, attrs). They can't catch visual regressions like "the math
 * renders as red error text" or "the section heading typography is
 * off". This script gives you a quick before/after eyeball.
 *
 * The output is pure HTML — no Electron, no React, no node views.
 * Math is pre-rendered to KaTeX HTML; figures/citations/links use
 * the same DOM shape the schema's `toDOM` produces.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const fixturesDir = join(root, 'test/fixtures')
const outDir = join(root, 'preview')

mkdirSync(outDir, { recursive: true })

// Load the parser via tsx (npm script wraps with --import tsx).
const parserUrl = pathToFileURL(
  join(root, 'src/renderer/src/editor/wysiwyg/latex-to-doc.ts')
).href
const { parseLatexToDoc } = await import(parserUrl)

// KaTeX server-side rendering. We import the bundled CSS so the
// generated HTML matches what the editor produces.
const katexMod = await import('katex')
const katex = katexMod.default ?? katexMod
const katexCssPath = join(root, 'node_modules/katex/dist/katex.min.css')
const katexCss = readFileSync(katexCssPath, 'utf-8')

// Copy katex font files alongside the HTML so the @font-face urls in
// katex.min.css resolve when you open preview/index.html in a browser.
const katexFontsSrc = join(root, 'node_modules/katex/dist/fonts')
const katexFontsDst = join(outDir, 'fonts')
mkdirSync(katexFontsDst, { recursive: true })
for (const f of readdirSync(katexFontsSrc)) {
  copyFileSync(join(katexFontsSrc, f), join(katexFontsDst, f))
}

const designTokensCss = readFileSync(
  join(root, 'src/renderer/src/assets/main.css'),
  'utf-8'
)

const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.tex'))
fixtures.sort()

const indexLinks = []
for (const file of fixtures) {
  const tex = readFileSync(join(fixturesDir, file), 'utf-8')
  let bodyHtml = ''
  let parseError = null
  try {
    const { doc, mathMacros } = await parseLatexToDoc(tex)
    bodyHtml = renderDoc(doc, mathMacros ?? {})
  } catch (err) {
    parseError = err
    bodyHtml = `<pre class="error">Parse failed: ${escapeHtml(String(err))}</pre>`
  }

  const html = pageTemplate({
    title: file,
    katexCss,
    designTokensCss,
    rendered: bodyHtml,
    source: tex
  })

  const outName = file.replace(/\.tex$/, '.html')
  writeFileSync(join(outDir, outName), html)
  indexLinks.push({ file: outName, source: file, error: !!parseError })
}

// Index page lists every fixture.
const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>synthetic-corbato — fixture preview</title>
<style>
${designTokensCss}
/* Override main.css's editor-app body (overflow:hidden + 100% height
   locked viewport) — the index page is a regular long-form list. */
html, body { height: auto; overflow: auto; }
body { padding: 32px 48px; max-width: 760px; margin: 0 auto; }
h1 { font-family: var(--font-serif); font-size: 22px; margin-bottom: 8px; }
.subtitle { color: var(--text-secondary); margin-bottom: 24px; font-size: 13px; }
ul { list-style: none; padding: 0; }
li { padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 6px; }
li a { color: var(--text-primary); text-decoration: none; font-weight: 500; }
li a:hover { text-decoration: underline; }
.err { color: var(--status-error); font-size: 11px; margin-left: 8px; }
.tag { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono); margin-left: 8px; }
</style>
</head>
<body>
<h1>fixture preview</h1>
<p class="subtitle">Renders every <code>test/fixtures/*.tex</code> through the WYSIWYG parser. Open one to eyeball the rendering.</p>
<ul>
${indexLinks.map((l) => `<li><a href="./${l.file}">${escapeHtml(l.source)}</a><span class="tag">${escapeHtml(l.file)}</span>${l.error ? '<span class="err">parse error</span>' : ''}</li>`).join('\n')}
</ul>
</body>
</html>
`
writeFileSync(join(outDir, 'index.html'), indexHtml)

console.log(`✔ Wrote ${fixtures.length} fixture previews → ${outDir}/index.html`)

// ─────────────────────────────────────────────────────────────────
// Renderers — convert PM doc → HTML string (mirrors the schema's
// `toDOM` shape but pre-renders KaTeX since this is static HTML).
// ─────────────────────────────────────────────────────────────────

function renderDoc(doc, macros = {}) {
  let html = ''
  doc.forEach((child) => (html += renderBlock(child, macros)))
  return html
}

function renderBlock(node, macros) {
  switch (node.type.name) {
    case 'preamble': {
      const lines = (node.attrs.source ?? '').split('\n').length
      return `<details class="preamble">
  <summary>Preamble · ${lines} line${lines === 1 ? '' : 's'} (click to view)</summary>
  <pre>${escapeHtml(node.attrs.source ?? '')}</pre>
</details>`
    }
    case 'section': {
      let inner = ''
      node.forEach((child) => (inner += renderBlock(child, macros)))
      return `<section data-level="${node.attrs.level}">${inner}</section>`
    }
    case 'sectionTitle': {
      const tag = `h${Math.min(3, Math.max(1, node.attrs.level))}`
      return `<${tag}>${renderInline(node, macros)}</${tag}>`
    }
    case 'paragraph':
      return `<p>${renderInline(node, macros)}</p>`
    case 'mathBlock':
      return `<div class="math-block">${renderMath(node.attrs.latex ?? '', true, macros)}</div>`
    case 'figure': {
      const src = node.attrs.src ?? ''
      const cap = escapeHtml(node.attrs.caption ?? '')
      return `<figure class="figure-block">
  <img class="figure-block__image figure-block__image--empty" alt="${cap || 'figure'}" data-src="${escapeHtml(src)}">
  ${cap ? `<figcaption class="figure-block__caption">${cap}</figcaption>` : ''}
</figure>`
    }
    case 'rawLatex':
      return `<pre class="raw-latex-block">${escapeHtml(node.attrs.source ?? '')}</pre>`
    case 'listBlock': {
      const tag = node.attrs.kind === 'enumerate' ? 'ol' : 'ul'
      let inner = ''
      node.forEach((item) => (inner += renderBlock(item, macros)))
      return `<${tag}>${inner}</${tag}>`
    }
    case 'listItem': {
      let inner = ''
      node.forEach((child) => (inner += renderBlock(child, macros)))
      return `<li>${inner}</li>`
    }
    case 'theoremEnv': {
      const kind = node.attrs.kind ?? 'theorem'
      const title = node.attrs.title ?? ''
      const label = node.attrs.label ?? ''
      let inner = ''
      node.forEach((child) => (inner += renderBlock(child, macros)))
      return `<aside class="theorem-env theorem-env--${escapeHtml(kind)}"${label ? ` data-label="${escapeHtml(label)}"` : ''}>
  <header class="theorem-env__head">
    <span class="theorem-env__kind">${escapeHtml(capitalize(kind))}</span>
    ${title ? `<span class="theorem-env__title">(${escapeHtml(title)})</span>` : ''}
    ${label ? `<span class="theorem-env__label">${escapeHtml(label)}</span>` : ''}
  </header>
  <div class="theorem-env__body">${inner}</div>
</aside>`
    }
    case 'bibliography': {
      let inner = ''
      node.forEach((child) => (inner += renderBlock(child, macros)))
      return `<section class="bibliography">
  <h2 class="bibliography__head">References</h2>
  <ol class="bibliography__list">${inner}</ol>
</section>`
    }
    case 'bibitem': {
      const key = node.attrs.key ?? ''
      const inline = renderInline(node, macros)
      return `<li class="bibitem" data-key="${escapeHtml(key)}">
  <code class="bibitem__key" title="cite key — click to copy">${escapeHtml(key)}</code>
  <div class="bibitem__body">${inline}</div>
</li>`
    }
    default:
      return ''
  }
}

function capitalize(s) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

function renderInline(node, macros = {}) {
  let html = ''
  node.forEach((child) => {
    if (child.isText) {
      html += wrapMarks(escapeHtml(child.text ?? ''), child.marks)
    } else {
      switch (child.type.name) {
        case 'mathInline':
          html += `<span class="math-inline">${renderMath(child.attrs.latex ?? '', false, macros)}</span>`
          break
        case 'citation':
          html += `<span class="citation-chip">[${escapeHtml((child.attrs.keys ?? []).join(', '))}]</span>`
          break
        case 'crossRef':
          html += `<span class="cross-ref-chip">→ ${escapeHtml(child.attrs.label ?? '')}</span>`
          break
      }
    }
  })
  return html
}

function wrapMarks(text, marks) {
  let result = text
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'em': result = `<em>${result}</em>`; break
      case 'strong': result = `<strong>${result}</strong>`; break
      case 'code': result = `<code>${result}</code>`; break
      case 'smallcaps': result = `<span style="font-variant: small-caps">${result}</span>`; break
      case 'link': result = `<a href="${escapeHtml(mark.attrs.href ?? '')}">${result}</a>`; break
    }
  }
  return result
}

function renderMath(latex, displayMode, macros = {}) {
  // Strip `\[...\]` since KaTeX doesn't recognize the delimiters; envs
  // pass through verbatim (KaTeX handles `\begin{equation}` etc).
  let src = latex.trim()
  if (displayMode) {
    const m = /^\\\[([\s\S]*?)\\\]$/.exec(src)
    if (m) src = m[1].trim()
  }
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode,
      strict: false,
      // Pass user-defined preamble macros (\norm, \E, \R, \PP, …) so KaTeX
      // expands them instead of rendering them in red as unknown commands.
      // The `\label` / `\nonumber` / `\notag` no-ops are also seeded in
      // extractMathMacros so they don't bleed into adjacent tokens.
      macros
    })
  } catch (err) {
    return `<span class="math-error">${escapeHtml(src)}</span>`
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pageTemplate({ title, katexCss, designTokensCss, rendered, source }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — preview</title>
<style>
${designTokensCss}
${katexCss}

body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100vh;
  overflow: hidden;
}

.pane {
  overflow: auto;
  padding: 32px 48px;
}

.pane--rendered {
  background: var(--paper-bg);
  font-family: var(--font-serif);
  font-size: var(--paper-body-size);
  line-height: var(--paper-line-height);
  color: var(--paper-text);
  border-right: 1px solid var(--border-color);
}

.pane--source {
  background: var(--bg-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

.pane--rendered h1 { font-size: 1.55em; font-weight: 700; margin: 1.6em 0 0.6em 0; }
.pane--rendered h2 { font-size: 1.25em; font-weight: 700; margin: 1.4em 0 0.5em 0; }
.pane--rendered h3 { font-size: 1.05em; font-weight: 700; margin: 1.2em 0 0.4em 0; }
.pane--rendered p  { margin: 0 0 0.9em 0; text-align: justify; hyphens: auto; }
.pane--rendered code { font-family: var(--font-mono); background: var(--bg-secondary); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
.pane--rendered .citation-chip,
.pane--rendered .cross-ref-chip {
  display: inline-block;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.85em;
  padding: 0 6px;
  border-radius: 3px;
  margin: 0 1px;
}
.pane--rendered .raw-latex-block {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  padding: 8px 12px;
  border-radius: 4px;
  margin: 1em 0;
  white-space: pre-wrap;
  overflow-x: auto;
}
.pane--rendered .math-block { margin: 1em 0; text-align: center; }
.pane--rendered .figure-block { margin: 1em 0; text-align: center; }
.pane--rendered .figure-block__image--empty {
  display: inline-block;
  width: 320px; height: 180px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
}
.pane--rendered .preamble {
  margin-bottom: 1.5em;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}
.pane--rendered .preamble summary {
  cursor: pointer;
  background: var(--bg-secondary);
  padding: 6px 10px;
  border-radius: 4px;
}
.pane--rendered .preamble pre {
  background: var(--bg-secondary);
  padding: 8px 10px;
  margin-top: 6px;
  border-radius: 4px;
  white-space: pre-wrap;
}

/* Theorem-like callouts. The left rule is the visual cue; the kind label
   sits above the body in bold so the structure reads at a glance. */
.pane--rendered .theorem-env {
  margin: 1em 0;
  padding: 0.6em 0 0.6em 14px;
  border-left: 3px solid var(--text-tertiary);
  background: var(--bg-secondary);
  border-radius: 0 4px 4px 0;
  padding-right: 14px;
}
.pane--rendered .theorem-env--theorem,
.pane--rendered .theorem-env--lemma,
.pane--rendered .theorem-env--proposition,
.pane--rendered .theorem-env--corollary {
  border-left-color: #2563eb;
}
.pane--rendered .theorem-env--definition,
.pane--rendered .theorem-env--assumption,
.pane--rendered .theorem-env--conjecture {
  border-left-color: #16a34a;
}
.pane--rendered .theorem-env--remark,
.pane--rendered .theorem-env--note,
.pane--rendered .theorem-env--observation {
  border-left-color: #d97706;
}
.pane--rendered .theorem-env--example,
.pane--rendered .theorem-env--fact,
.pane--rendered .theorem-env--claim {
  border-left-color: #6366f1;
}
.pane--rendered .theorem-env--proof {
  border-left-color: var(--text-tertiary);
  background: transparent;
  font-style: normal;
}
.pane--rendered .theorem-env__head {
  font-family: var(--font-sans);
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.4em;
  color: var(--text-secondary);
}
.pane--rendered .theorem-env__kind { font-weight: 700; color: var(--text-primary); }
.pane--rendered .theorem-env__title { margin-left: 4px; font-weight: 500; text-transform: none; }
.pane--rendered .theorem-env__label {
  margin-left: 8px;
  font-family: var(--font-mono);
  font-size: 0.85em;
  text-transform: none;
  color: var(--text-tertiary);
}
.pane--rendered .theorem-env__body > p:first-child { margin-top: 0; }
.pane--rendered .theorem-env__body > p:last-child { margin-bottom: 0; }
.pane--rendered .theorem-env--proof .theorem-env__body > p:last-child::after {
  content: ' \\220E'; /* QED tombstone */
  margin-left: 0.5em;
  color: var(--text-tertiary);
}

/* Bibliography. The cite-key sits in a monospace chip on the left so the
   user can grab it without dragging through prose. */
.pane--rendered .bibliography {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--border-color);
}
.pane--rendered .bibliography__head {
  font-size: 1.25em;
  font-weight: 700;
  margin: 0 0 0.6em 0;
}
.pane--rendered .bibliography__list {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: bibitem;
}
.pane--rendered .bibitem {
  position: relative;
  padding: 8px 130px 8px 36px;
  border-radius: 4px;
  counter-increment: bibitem;
  margin: 0;
  font-size: 0.95em;
  line-height: 1.45;
  list-style: none;
}
.pane--rendered .bibitem:hover { background: var(--bg-secondary); }
.pane--rendered .bibitem::before {
  content: '[' counter(bibitem) ']';
  position: absolute;
  left: 0;
  top: 8px;
  width: 28px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 0.85em;
  text-align: right;
}
.pane--rendered .bibitem__body {
  color: var(--paper-text);
}
.pane--rendered .bibitem__key {
  position: absolute;
  right: 8px;
  top: 6px;
  max-width: 110px;
  font-family: var(--font-mono);
  font-size: 0.75em;
  background: transparent;
  color: var(--text-tertiary);
  padding: 2px 6px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  cursor: pointer;
  user-select: all;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pane--rendered .bibitem__key:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
.pane--rendered .math-error { color: var(--status-error); font-family: var(--font-mono); font-size: 0.85em; }

.titlebar {
  position: fixed;
  top: 0; left: 0; right: 0;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  padding: 8px 16px;
  font-size: 12px;
  font-family: var(--font-sans);
  color: var(--text-secondary);
  z-index: 10;
}
.titlebar a { color: var(--text-secondary); margin-right: 12px; }
.error {
  background: var(--bg-secondary);
  color: var(--status-error);
  padding: 12px;
  border-radius: 6px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
}
</style>
</head>
<body>
<div class="titlebar">
  <a href="./index.html">← all fixtures</a>
  <strong>${escapeHtml(title)}</strong>
</div>
<div class="pane pane--rendered" style="padding-top: 50px">
  ${rendered}
</div>
<div class="pane pane--source" style="padding-top: 50px">${escapeHtml(source)}</div>
</body>
</html>
`
}
