import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState
} from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { latexSchema } from './schema'
import * as labelRegistry from './labelRegistry'
import { createIcon, type IconName } from './icons'

// A `/` command menu for inserting LaTeX structures.
//
// Built as a ProseMirror plugin with plain DOM rather than a React portal:
// the menu has to track the caret through every transaction, and routing that
// through React state adds a frame of lag to something that should feel
// instant. It also keeps the menu inside the editor's own coordinate space,
// so it follows the text when the view scrolls.
//
// Two kinds of entry:
//   - static structures (equation, matrix, table, theorem, …)
//   - live entries drawn from the label registry, so `/cite` lists the keys
//     actually in the bibliography and `/ref` lists labels actually defined.
//     Typing a key you'd have to look up is the slow part of citing.

export const slashMenuKey = new PluginKey<SlashState>('slashMenu')

interface SlashState {
  /** Position of the `/` that opened the menu, or null when closed. */
  from: number | null
  query: string
}

interface SlashItem {
  title: string
  /** Right-aligned hint: a shortcut reminder or the LaTeX it produces. */
  hint: string
  /** Extra words to match against, beyond the title. */
  keywords: string
  group: string
  /**
   * Leading glyph. Worth the space: a menu of fifteen near-identical text
   * rows is read one line at a time, whereas a distinct shape per kind lets
   * the eye jump straight to the matrix or the table.
   */
  icon: IconName
  run: (view: EditorView, from: number, to: number) => void
}

// ── Insertion helpers ──────────────────────────────────────────────────

/**
 * Atoms whose node view opens an editor when the node is selected. For these
 * a `NodeSelection` *is* landing inside the thing.
 *
 * Deliberately not every atom: selecting a figure leaves it armed, so the
 * next keystroke would replace it. Better to sit after one than on top of it.
 */
const OPENS_WHEN_SELECTED = new Set(['mathBlock', 'mathInline', 'codeBlock'])

/**
 * Where the caret belongs once a node has been inserted at `pos`.
 *
 * This used to be an optional `caretOffset` that no entry ever passed, so the
 * branch guarding it was dead and every insert left the selection wherever
 * the mapping happened to drop it — usually just outside the thing that had
 * been asked for. Picking `/equation` put an empty display on the page and
 * the caret in the paragraph beside it, so the next keystroke went into prose.
 */
function selectionInside(doc: PMNode, pos: number, node: PMNode): Selection {
  if (OPENS_WHEN_SELECTED.has(node.type.name)) {
    try {
      return NodeSelection.create(doc, pos)
    } catch {
      /* not selectable after all; fall through */
    }
  }
  // An atom has no inside, so the nearest useful place is just past it.
  if (node.isAtom) return Selection.near(doc.resolve(pos + node.nodeSize), 1)
  // Everything else — theorem, list, float — has a first text position, and
  // that is where an author expects to be after asking for one.
  return Selection.near(doc.resolve(pos + 1), 1)
}

/** Replace the `/query` text with a block node, then put the caret in it. */
function replaceWithBlock(view: EditorView, from: number, to: number, node: PMNode): void {
  const { tr } = view.state
  tr.delete(from, to)
  // `from` now sits in an empty paragraph if the user typed `/` on a blank
  // line. Replacing that paragraph rather than nesting inside it is what
  // makes `/equation` produce a display, not a display wrapped in a stub.
  const $pos = tr.doc.resolve(from)
  const parent = $pos.parent
  let start: number
  if (parent.type.name === 'paragraph' && parent.content.size === 0) {
    start = $pos.before()
    tr.replaceWith(start, start + parent.nodeSize, node)
  } else {
    start = $pos.after()
    tr.insert(start, node)
  }
  tr.setSelection(selectionInside(tr.doc, start, node))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/**
 * Replace the `/query` text with an inline node.
 *
 * `select` leaves a NodeSelection on the inserted node, which is how a node
 * view learns to open its editor: picking "Inline math" from the menu is a
 * statement of intent to type a formula, so landing on a rendered `x` that
 * has to be clicked is a step nobody wanted.
 */
function replaceWithInline(
  view: EditorView,
  from: number,
  to: number,
  node: PMNode,
  select = false
): void {
  const tr = view.state.tr.replaceWith(from, to, node)
  if (select) tr.setSelection(NodeSelection.create(tr.doc, from))
  else tr.setSelection(Selection.near(tr.doc.resolve(from + node.nodeSize), 1))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

const mathBlock = (latex: string): PMNode =>
  latexSchema.nodes.mathBlock.create({ latex, label: null })

const paragraphWith = (text: string): PMNode =>
  latexSchema.nodes.paragraph.create({}, text ? latexSchema.text(text) : undefined)

function listOf(kind: string, items: string[]): PMNode {
  return latexSchema.nodes.listBlock.create(
    { kind, options: '' },
    items.map((text) =>
      latexSchema.nodes.listItem.create({ marker: null }, [paragraphWith(text)])
    )
  )
}

function theoremOf(kind: string): PMNode {
  return latexSchema.nodes.theoremEnv.create({ kind, label: null, title: null }, [
    paragraphWith('')
  ])
}

// A tabular skeleton. Written as raw source because that's how tabular is
// modelled — the rich table renderer picks it up and displays a real grid.
function tabularSource(rows: number, cols: number): string {
  const spec = `@{}${'l'.repeat(cols)}@{}`
  const header = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' & ')
  const body = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' ').join('&'))
    .map((r) => `  ${r} \\\\`)
    .join('\n')
  return `\\begin{tabular}{${spec}}\n  \\toprule\n  ${header} \\\\\n  \\midrule\n${body}\n  \\bottomrule\n\\end{tabular}`
}

function matrixSource(env: string, n: number): string {
  const row = Array.from({ length: n }, () => '0').join(' & ')
  const body = Array.from({ length: n }, () => `  ${row}`).join(' \\\\\n')
  return `\\[\n\\begin{${env}}\n${body}\n\\end{${env}}\n\\]`
}

// ── The catalogue ──────────────────────────────────────────────────────

const STATIC_ITEMS: SlashItem[] = [
  {
    title: 'Display equation',
    icon: 'function',
    hint: 'equation',
    keywords: 'math display numbered',
    group: 'Math',
    run: (v, f, t) =>
      replaceWithBlock(v, f, t, mathBlock('\\begin{equation}\n  \n\\end{equation}'))
  },
  {
    title: 'Unnumbered equation',
    icon: 'parentheses',
    hint: '\\[ … \\]',
    keywords: 'math display plain',
    group: 'Math',
    run: (v, f, t) => replaceWithBlock(v, f, t, mathBlock('\\[\n  \n\\]'))
  },
  {
    title: 'Aligned equations',
    icon: 'equal',
    hint: 'align',
    keywords: 'math multiline align system',
    group: 'Math',
    run: (v, f, t) =>
      replaceWithBlock(v, f, t, mathBlock('\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}'))
  },
  {
    title: 'Cases',
    icon: 'braces',
    hint: 'cases',
    keywords: 'math piecewise branch',
    group: 'Math',
    run: (v, f, t) =>
      replaceWithBlock(
        v,
        f,
        t,
        mathBlock('\\[\nf(x) =\n\\begin{cases}\n  a & x > 0, \\\\\n  b & x \\le 0.\n\\end{cases}\n\\]')
      )
  },
  {
    title: 'Matrix (2×2)',
    icon: 'grid2',
    hint: 'pmatrix',
    keywords: 'math matrix array grid',
    group: 'Math',
    run: (v, f, t) => replaceWithBlock(v, f, t, mathBlock(matrixSource('pmatrix', 2)))
  },
  {
    title: 'Matrix (3×3)',
    icon: 'grid',
    hint: 'pmatrix',
    keywords: 'math matrix array grid',
    group: 'Math',
    run: (v, f, t) => replaceWithBlock(v, f, t, mathBlock(matrixSource('pmatrix', 3)))
  },
  {
    title: 'Bracket matrix',
    icon: 'brackets',
    hint: 'bmatrix',
    keywords: 'math matrix square bracket',
    group: 'Math',
    run: (v, f, t) => replaceWithBlock(v, f, t, mathBlock(matrixSource('bmatrix', 2)))
  },
  {
    title: 'Inline math',
    icon: 'sigma',
    hint: '$…$',
    keywords: 'math formula inline',
    group: 'Math',
    // Empty, not a placeholder `x`: the editor opens on it immediately, so a
    // seed value would only be something to delete first. An edit left blank
    // takes the node with it — see MathNodeView.
    run: (v, f, t) =>
      replaceWithInline(v, f, t, latexSchema.nodes.mathInline.create({ latex: '' }), true)
  },
  {
    title: 'Table',
    icon: 'table',
    hint: 'tabular',
    keywords: 'table tabular grid booktabs',
    group: 'Structure',
    run: (v, f, t) =>
      replaceWithBlock(
        v,
        f,
        t,
        latexSchema.nodes.floatBlock.create({ kind: 'table', args: '[htbp]', centering: true }, [
          latexSchema.nodes.rawLatex.create({ source: tabularSource(2, 3) }),
          latexSchema.nodes.caption.create({}, latexSchema.text('Caption.'))
        ])
      )
  },
  {
    title: 'Figure',
    icon: 'image',
    hint: 'includegraphics',
    keywords: 'figure image graphic plot',
    group: 'Structure',
    run: (v, f, t) =>
      replaceWithBlock(
        v,
        f,
        t,
        latexSchema.nodes.figure.create({
          src: 'figures/example.pdf',
          caption: 'Caption.',
          width: '0.7\\linewidth',
          placement: 'htbp'
        })
      )
  },
  {
    title: 'Code block',
    icon: 'code',
    hint: 'lstlisting',
    keywords: 'code listing verbatim snippet',
    group: 'Structure',
    run: (v, f, t) =>
      replaceWithBlock(
        v,
        f,
        t,
        latexSchema.nodes.codeBlock.create({
          code: '',
          env: 'lstlisting',
          options: 'language=Python',
          language: 'Python'
        })
      )
  },
  {
    title: 'Bulleted list',
    icon: 'list',
    hint: 'itemize',
    keywords: 'list bullet itemize unordered',
    group: 'Structure',
    run: (v, f, t) => replaceWithBlock(v, f, t, listOf('itemize', ['', '']))
  },
  {
    title: 'Numbered list',
    icon: 'listOrdered',
    hint: 'enumerate',
    keywords: 'list numbered enumerate ordered',
    group: 'Structure',
    run: (v, f, t) => replaceWithBlock(v, f, t, listOf('enumerate', ['', '']))
  },
  {
    title: 'Description list',
    icon: 'listTree',
    hint: 'description',
    keywords: 'list description term definition',
    group: 'Structure',
    run: (v, f, t) => replaceWithBlock(v, f, t, listOf('description', ['', '']))
  },
  {
    title: 'Footnote',
    icon: 'superscript',
    hint: '\\footnote',
    keywords: 'footnote note aside',
    group: 'Structure',
    run: (v, f, t) =>
      replaceWithInline(
        v,
        f,
        t,
        latexSchema.nodes.footnote.create({ source: 'Note.', cmd: 'footnote' })
      )
  }
]

const THEOREM_KINDS = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'proof']

for (const kind of THEOREM_KINDS) {
  STATIC_ITEMS.push({
    title: kind[0].toUpperCase() + kind.slice(1),
    // A proof is the one entry in this group that ends an argument rather
    // than stating one, so it gets its own glyph.
    icon: kind === 'proof' ? 'check' : 'quote',
    hint: `\\begin{${kind}}`,
    keywords: `theorem environment ${kind}`,
    group: 'Theorems',
    run: (v, f, t) => replaceWithBlock(v, f, t, theoremOf(kind))
  })
}

/**
 * Entries that depend on the current document: bibliography keys and
 * defined labels. Rebuilt per keystroke because the registry is cheap to
 * read and the document changes under the menu.
 */
function dynamicItems(): SlashItem[] {
  const out: SlashItem[] = []
  const { citations, byKey } = labelRegistry.getState()

  for (const [key, cite] of citations) {
    out.push({
      title: cite.shortLabel && cite.shortLabel !== key ? cite.shortLabel : key,
      icon: 'book',
      hint: key,
      keywords: `cite citation reference bib ${key}`,
      group: 'Citations',
      run: (v, f, t) =>
        replaceWithInline(
          v,
          f,
          t,
          latexSchema.nodes.citation.create({ keys: [key], cmd: 'cite', prenote: null, postnote: null })
        )
    })
  }

  for (const [key, ref] of byKey) {
    out.push({
      title: ref.pretty || key,
      icon: 'link',
      hint: key,
      keywords: `ref cref reference label ${key} ${ref.kindLabel}`,
      group: 'Cross-references',
      run: (v, f, t) =>
        replaceWithInline(
          v,
          f,
          t,
          latexSchema.nodes.crossRef.create({ label: key, keys: [key], cmd: 'cref' })
        )
    })
  }
  return out
}

// ── Matching ───────────────────────────────────────────────────────────

/** Score for a literal substring hit — the weakest match still worth trusting. */
const SOLID = 50

function scoreItem(item: SlashItem, query: string): number {
  if (!query) return item.group === 'Citations' || item.group === 'Cross-references' ? 1 : 2
  const q = query.toLowerCase()
  const title = item.title.toLowerCase()
  const haystack = `${title} ${item.keywords.toLowerCase()} ${item.hint.toLowerCase()}`
  if (title.startsWith(q)) return 100
  if (haystack.includes(q)) return SOLID
  // Subsequence match, so `dseq` finds "Display equation".
  let i = 0
  for (const ch of haystack) {
    if (ch === q[i]) i++
    if (i === q.length) return 10
  }
  return 0
}

function matchingItems(query: string): SlashItem[] {
  // A query with a space in it is being read as prose until proven otherwise,
  // so subsequence matches don't count: almost any sentence is a subsequence
  // of *something* in a forty-entry catalogue, and a menu that stays open
  // over ordinary writing is worse than one that closes too eagerly.
  const floor = /\s/.test(query) ? SOLID : 1
  const all = [...STATIC_ITEMS, ...dynamicItems()]
  return all
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((entry) => entry.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((entry) => entry.item)
}

// ── The plugin ─────────────────────────────────────────────────────────

/** Mirrors `max-height` on `.slash-menu`; the placement maths needs the number. */
const SLASH_MENU_MAX_HEIGHT = 320

/** Beyond this the author is plainly writing, not choosing. */
const MAX_QUERY = 48

/**
 * Whether the menu should stay open for `query`.
 *
 * The old rule was "any whitespace closes it", which is what an @-mention
 * does and is wrong here: the things worth searching for have spaces in
 * their names. A cross-reference reads "Theorem 3.2" and a citation reads
 * "Knuth 1984", so `/theorem 3` died on the space bar exactly when it was
 * about to become useful.
 *
 * So spaces are allowed and the stop condition is meaning instead: once
 * nothing in the catalogue matches the words typed so far, the author has
 * moved on to prose and the menu gets out of the way.
 */
function queryLives(query: string): boolean {
  if (/\n/.test(query)) return false
  if (query.length > MAX_QUERY) return false
  if (!/\s/.test(query)) return true
  // `/ ` on its own is a slash followed by a space, not a search.
  if (query.trim() === '') return false
  return matchingItems(query).length > 0
}

// A `/` only opens the menu at a word boundary, so a URL or a maths
// expression typed in prose doesn't trigger it.
function opensMenu(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos)
  if (!$pos.parent.isTextblock) return false
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 1), $pos.parentOffset)
  return before === '' || /\s/.test(before)
}

class SlashMenuView {
  private dom: HTMLElement
  private items: SlashItem[] = []
  private selected = 0
  private open = false

  constructor(private view: EditorView) {
    this.dom = document.createElement('div')
    this.dom.className = 'slash-menu'
    this.dom.setAttribute('role', 'listbox')
    this.dom.style.display = 'none'
    document.body.appendChild(this.dom)
    this.update(view)
  }

  update(view: EditorView): void {
    this.view = view
    const state = slashMenuKey.getState(view.state)
    if (!state || state.from === null) {
      this.hide()
      return
    }
    const items = matchingItems(state.query)
    // Preserve the highlighted row across keystrokes where the list didn't
    // change; reset it when it did, so the top match is selected.
    const sameList =
      items.length === this.items.length && items.every((it, i) => it.title === this.items[i].title)
    this.items = items
    if (!sameList) this.selected = 0
    if (items.length === 0) {
      this.hide()
      return
    }
    this.open = true
    this.render(state.from)
  }

  private hide(): void {
    if (!this.open) return
    this.open = false
    this.dom.style.display = 'none'
    this.dom.replaceChildren()
  }

  private render(from: number): void {
    this.dom.replaceChildren()
    let lastGroup = ''
    this.items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group
        const header = document.createElement('div')
        header.className = 'slash-menu__group'
        header.textContent = item.group
        this.dom.appendChild(header)
      }
      const row = document.createElement('div')
      row.className = 'slash-menu__item'
      if (index === this.selected) row.classList.add('slash-menu__item--active')
      row.setAttribute('role', 'option')

      const icon = document.createElement('span')
      icon.className = 'slash-menu__icon'
      icon.appendChild(createIcon(item.icon, 15))
      const title = document.createElement('span')
      title.className = 'slash-menu__title'
      title.textContent = item.title
      const hint = document.createElement('span')
      hint.className = 'slash-menu__hint'
      hint.textContent = item.hint
      row.append(icon, title, hint)

      // mousedown, not click: click fires after the editor has already lost
      // and regained selection, which closes the menu before we can act.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        this.selected = index
        this.commit()
      })
      row.addEventListener('mouseenter', () => {
        this.selected = index
        this.highlight()
      })
      this.dom.appendChild(row)
    })

    // `coordsAtPos` throws when the position isn't laid out yet — during the
    // same tick a node view replaces itself, and always under a DOM without
    // layout. The menu's contents are already correct at that point, so keep
    // it where it is rather than tearing it down.
    let coords: { top: number; bottom: number; left: number }
    try {
      coords = this.view.coordsAtPos(from)
    } catch {
      this.dom.style.display = 'block'
      return
    }
    this.dom.style.display = 'block'
    this.position(coords)
  }

  /**
   * Place the menu next to the caret without ever covering it.
   *
   * The previous version flipped above when the menu didn't fit below, then
   * clamped the result to the top of the window — so a tall menu near the
   * middle of a short window landed at y=8 and sat right on top of the line
   * being typed. Capping the height to the room on the chosen side is what
   * makes the flip honest: the menu scrolls instead of spilling over the
   * caret.
   */
  private position(coords: { top: number; bottom: number; left: number }): void {
    const MARGIN = 8
    const GAP = 6
    const MIN_HEIGHT = 140

    // Measure unclamped, so the side is chosen on what the menu wants rather
    // than on the cap a previous placement left behind.
    this.dom.style.maxHeight = ''
    const wanted = this.dom.offsetHeight
    const below = window.innerHeight - coords.bottom - GAP - MARGIN
    const above = coords.top - GAP - MARGIN
    const placeBelow = below >= wanted || below >= above

    const room = Math.max(MIN_HEIGHT, Math.min(SLASH_MENU_MAX_HEIGHT, placeBelow ? below : above))
    this.dom.style.maxHeight = `${room}px`
    const height = Math.min(wanted, room)

    const top = placeBelow ? coords.bottom + GAP : coords.top - GAP - height
    this.dom.style.top = `${Math.max(MARGIN, top)}px`
    this.dom.style.left = `${Math.max(MARGIN, Math.min(coords.left, window.innerWidth - this.dom.offsetWidth - 12))}px`
    this.scrollSelectedIntoView()
  }

  private highlight(): void {
    const rows = this.dom.querySelectorAll('.slash-menu__item')
    rows.forEach((row, i) => row.classList.toggle('slash-menu__item--active', i === this.selected))
  }

  private scrollSelectedIntoView(): void {
    const row = this.dom.querySelectorAll('.slash-menu__item')[this.selected]
    row?.scrollIntoView({ block: 'nearest' })
  }

  /** Run the highlighted item, replacing the typed `/query`. */
  private commit(): void {
    const state = slashMenuKey.getState(this.view.state)
    if (!state || state.from === null) return
    const item = this.items[this.selected]
    if (!item) return
    const from = state.from
    const to = this.view.state.selection.head
    this.hide()
    // Close first so the menu can't act on a stale document.
    this.view.dispatch(this.view.state.tr.setMeta(slashMenuKey, { close: true }))
    item.run(this.view, from, to)
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.open) return false
    switch (event.key) {
      case 'ArrowDown':
        this.selected = (this.selected + 1) % this.items.length
        this.highlight()
        this.scrollSelectedIntoView()
        return true
      case 'ArrowUp':
        this.selected = (this.selected - 1 + this.items.length) % this.items.length
        this.highlight()
        this.scrollSelectedIntoView()
        return true
      case 'Enter':
      case 'Tab':
        this.commit()
        return true
      case 'Escape':
        this.hide()
        this.view.dispatch(this.view.state.tr.setMeta(slashMenuKey, { close: true }))
        return true
      default:
        return false
    }
  }

  destroy(): void {
    this.dom.remove()
  }
}

export function slashMenu(): Plugin<SlashState> {
  let menuView: SlashMenuView | null = null

  return new Plugin<SlashState>({
    key: slashMenuKey,
    state: {
      init: () => ({ from: null, query: '' }),
      apply(tr, value, _old, newState) {
        if (tr.getMeta(slashMenuKey)?.close) return { from: null, query: '' }

        // Opening: the transaction inserted a `/` at a word boundary.
        if (tr.docChanged && value.from === null) {
          const head = newState.selection.head
          const $head = newState.doc.resolve(head)
          if ($head.parent.isTextblock && $head.parentOffset > 0) {
            const typed = $head.parent.textBetween($head.parentOffset - 1, $head.parentOffset)
            if (typed === '/' && opensMenu(newState, head - 1)) {
              return { from: head - 1, query: '' }
            }
          }
          return value
        }

        if (value.from === null) return value

        // Staying open: everything between the `/` and the caret is the
        // query. A space, a newline, or moving the caret behind the `/`
        // closes it — the same way an @-mention behaves.
        const head = newState.selection.head
        const from = tr.mapping.map(value.from)
        if (head < from + 1) return { from: null, query: '' }
        const $from = newState.doc.resolve(from)
        if (!$from.parent.isTextblock) return { from: null, query: '' }
        const text = newState.doc.textBetween(from, head, '\n', '\ufffc')
        if (!text.startsWith('/')) return { from: null, query: '' }
        const query = text.slice(1)
        if (!queryLives(query)) return { from: null, query: '' }
        return { from, query }
      }
    },
    props: {
      handleKeyDown(_view, event) {
        return menuView?.handleKeyDown(event) ?? false
      }
    },
    view(editorView) {
      menuView = new SlashMenuView(editorView)
      return {
        update: (v) => menuView?.update(v),
        destroy: () => {
          menuView?.destroy()
          menuView = null
        }
      }
    }
  })
}
