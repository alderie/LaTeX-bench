import type { Node as PMNode } from 'prosemirror-model'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord
} from 'prosemirror-view'
import { getLabel, subscribe } from '../labelRegistry'
import { createIcon } from '../icons'

// Node view for theorem-like environments.
//
// The header used to be a CSS `::before` reading `attr(data-kind)` and
// `attr(data-title)`. That renders correctly and is completely inert: a
// generated box is not in the DOM, so "Theorem 3.1 (Bregman divergence)"
// could not be clicked, focused, or selected, and the only way to rename a
// theorem was to switch to the source view and find the `[…]` after its
// `\begin`. Titles are the one part of a theorem that gets rewritten often —
// they are how the thing is referred to in prose — so they need to be
// reachable where they are read.
//
// So the header is a real element now: the kind is a `<select>`, the title is
// click-to-edit, and an untitled theorem grows a quiet "name it" button on
// hover. The body below stays the `contentDOM`, fully editable as before.

/** Kinds always on offer, regardless of what the document already uses. */
const BASE_KINDS = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'proof']

class TheoremView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private head: HTMLElement
  private kindSelect: HTMLSelectElement
  private numberSlot: HTMLElement
  private titleSlot: HTMLElement
  private unsubscribe: () => void
  private editing = false
  private kindsLoaded = false
  private closeRename: (() => void) | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('aside')
    this.dom.setAttribute('data-theorem', '')

    this.head = document.createElement('header')
    this.head.className = 'theorem-head'
    // The header is chrome, not prose. Without this the caret can be placed
    // between the kind and the title, where typing goes nowhere.
    this.head.contentEditable = 'false'

    this.kindSelect = this.buildKindSelect()
    this.numberSlot = document.createElement('span')
    this.numberSlot.className = 'theorem-head__number'
    this.titleSlot = document.createElement('span')
    this.titleSlot.className = 'theorem-head__title-slot'
    this.head.append(this.kindSelect, this.numberSlot, this.titleSlot)

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'theorem-body'
    this.contentDOM.setAttribute('data-theorem-body', '')

    this.dom.append(this.head, this.contentDOM)
    this.applyAttrs()
    this.unsubscribe = subscribe(() => this.applyAttrs())
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.applyAttrs()
    return true
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private applyAttrs(): void {
    const kind = (this.node.attrs.kind as string) || 'theorem'
    const label = (this.node.attrs.label as string | null) || null
    const title = (this.node.attrs.title as string | null) || null

    this.dom.setAttribute('data-kind', kind)
    if (title) this.dom.setAttribute('data-title', title)
    else this.dom.removeAttribute('data-title')

    if (this.kindSelect.value !== kind) {
      if (!this.kindSelect.querySelector(`option[value="${cssEscape(kind)}"]`)) {
        this.kindSelect.appendChild(optionFor(kind))
      }
      this.kindSelect.value = kind
    }

    let number: string | null = null
    if (label) {
      this.dom.setAttribute('data-label', label)
      this.dom.id = `latex-anchor-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      number = getLabel(label)?.number ?? null
    } else {
      this.dom.removeAttribute('data-label')
      this.dom.removeAttribute('id')
    }
    if (number) this.dom.setAttribute('data-number', number)
    else this.dom.removeAttribute('data-number')
    this.numberSlot.textContent = number ?? ''

    // Never redraw the title out from under a rename in progress.
    if (!this.editing) this.renderTitle(title)
  }

  private renderTitle(title: string | null): void {
    this.titleSlot.replaceChildren()
    if (title) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'theorem-head__title'
      button.title = 'Click to rename'
      button.textContent = `(${title})`
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => this.startRename(title))
      this.titleSlot.appendChild(button)
      return
    }
    // Untitled is the common case, so the affordance stays out of the way
    // until the pointer is over the theorem (see `.theorem-head__add`).
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'theorem-head__add'
    add.title = 'Give this theorem a name'
    add.appendChild(createIcon('plus', 11))
    const text = document.createElement('span')
    text.textContent = 'name'
    add.appendChild(text)
    add.addEventListener('mousedown', (event) => event.preventDefault())
    add.addEventListener('click', () => this.startRename(''))
    this.titleSlot.appendChild(add)
  }

  // ── Renaming ───────────────────────────────────────────────────────────

  private startRename(initial: string): void {
    this.editing = true
    this.titleSlot.replaceChildren()

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'theorem-head__input'
    input.value = initial
    input.placeholder = 'name'
    input.spellcheck = false
    this.titleSlot.appendChild(input)
    input.focus()
    input.select()

    let done = false
    const finish = (commit: boolean): void => {
      if (done) return
      done = true
      this.editing = false
      this.closeRename = null
      document.removeEventListener('pointerdown', onPointerDown, true)
      const next = commit ? input.value.trim() : initial.trim()
      this.renderTitle(next === '' ? null : next)
      if (commit && next !== initial.trim()) this.writeTitle(next === '' ? null : next)
    }

    // Same reason as the sidebar rename: plenty of handlers in this app call
    // `preventDefault()` on mousedown so they don't steal focus, and those
    // clicks never produce a blur. Closing on pointerdown catches them.
    const onPointerDown = (event: Event): void => {
      if (event.target instanceof Node && input.contains(event.target)) return
      finish(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(true)
        this.view.focus()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
        this.view.focus()
      }
      event.stopPropagation()
    })
    input.addEventListener('blur', () => finish(true))
    this.closeRename = () => finish(true)
  }

  private writeTitle(title: string | null): void {
    this.setAttr({ title })
  }

  private setAttr(patch: Record<string, unknown>): void {
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch })
    )
  }

  // ── The kind picker ────────────────────────────────────────────────────

  private buildKindSelect(): HTMLSelectElement {
    const select = document.createElement('select')
    select.className = 'theorem-head__kind'
    select.title = 'Environment'
    select.appendChild(optionFor((this.node.attrs.kind as string) || 'theorem'))
    // Filled in on first interaction: working out which kinds are available
    // means walking the document, and doing that once per theorem at load
    // time would cost O(theorems × document).
    const load = (): void => this.loadKinds()
    select.addEventListener('pointerdown', load)
    select.addEventListener('focus', load)
    select.addEventListener('change', () => this.setAttr({ kind: select.value }))
    return select
  }

  /**
   * Kinds this document can actually use.
   *
   * Restricted to the ones already present in the document, plus a common
   * core. A theorem environment has to be declared with `\newtheorem` in the
   * preamble before LaTeX will accept it, and the editor doesn't read the
   * preamble's declarations — but a kind used elsewhere in the same document
   * is proof that it was declared.
   */
  private loadKinds(): void {
    if (this.kindsLoaded) return
    this.kindsLoaded = true
    const kinds = new Set(BASE_KINDS)
    kinds.add((this.node.attrs.kind as string) || 'theorem')
    this.view.state.doc.descendants((node) => {
      if (node.type.name === 'theoremEnv') kinds.add(node.attrs.kind as string)
    })
    const current = this.kindSelect.value
    this.kindSelect.replaceChildren(...[...kinds].sort().map(optionFor))
    this.kindSelect.value = current
  }

  // ── ProseMirror plumbing ───────────────────────────────────────────────

  stopEvent(event: Event): boolean {
    // Everything in the header is chrome; ProseMirror should keep its hands
    // off the keystrokes and clicks that land there.
    return event.target instanceof Node && this.head.contains(event.target)
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Our own `data-*` bookkeeping, and anything the header does to itself —
    // including a selection landing in the rename field.
    if (mutation.type === 'attributes' && mutation.target === this.dom) return true
    return this.head.contains(mutation.target)
  }

  destroy(): void {
    this.closeRename?.()
    this.unsubscribe()
  }
}

function optionFor(kind: string): HTMLOptionElement {
  const option = document.createElement('option')
  option.value = kind
  option.textContent = kind
  return option
}

/** Enough escaping for a `[value="…"]` lookup over environment names. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

export const theoremNodeView: NodeViewConstructor = (node, view, getPos) =>
  new TheoremView(node, view, getPos)
