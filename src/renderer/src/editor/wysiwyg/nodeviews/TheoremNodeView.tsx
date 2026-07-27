import type { Node as PMNode } from 'prosemirror-model'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord
} from 'prosemirror-view'
import { getLabel, subscribe } from '../labelRegistry'
import { createDropdown, type Dropdown, type DropdownOption } from '../dropdown'
import { createHeaderField, type HeaderField } from './header-field'

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
// The first pass at that gave every part its own kind of control: a dropdown
// for the kind, a bare span for the number, a button for the title that
// swapped itself for an input on click, and a second button for naming an
// untitled one. Four widgets, four heights, three fonts — a row of loose
// parts rather than a header, with the open name field sitting visibly
// off-centre against everything beside it.
//
// So it is one bar now, built the way the formula editor's is: same-height
// segments on a shared centre line, chrome that shows up only under the
// pointer or the caret. The kind is a dropdown, the number is text, and the
// name and the label are both `head-field`s — live inputs rather than
// click-to-edit, because something that already looks like a field needs no
// ceremony to start typing into. The body below stays the `contentDOM`.
//
// The kind picker is the app's own dropdown rather than a `<select>`: a native
// popup is drawn by the OS, so it arrived light-on-white in a dark editor, in
// the system font, at the system's idea of a row height — see `dropdown.ts`.

/** Kinds always on offer, regardless of what the document already uses. */
const BASE_KINDS = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'proof']

class TheoremView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private head: HTMLElement
  private kindPicker: Dropdown
  private numberSlot: HTMLElement
  private nameField: HeaderField
  private labelField: HeaderField
  private unsubscribe: () => void
  private kindsLoaded = false

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
    // between the kind and the name, where typing goes nowhere.
    this.head.contentEditable = 'false'

    this.kindPicker = this.buildKindPicker()

    this.numberSlot = document.createElement('span')
    this.numberSlot.className = 'theorem-head__number'

    // What the environment *is* on the left of the rule; what this particular
    // one is called on the right.
    const rule = document.createElement('span')
    rule.className = 'theorem-head__rule'

    this.nameField = createHeaderField({
      caption: 'name',
      placeholder: 'name',
      value: (this.node.attrs.title as string | null) ?? null,
      title: 'Name shown after the number — Theorem 3.5 (Bregman divergence)',
      onCommit: (value) => this.setAttr({ title: value }),
      onDone: () => this.view.focus()
    })
    this.nameField.dom.classList.add('theorem-head__name')

    const spacer = document.createElement('span')
    spacer.className = 'theorem-head__spacer'

    // Same field, same bar: a theorem is cross-referenced exactly as an
    // equation is, and until now the only way to give one a label was to open
    // the source view and write the `\label{}` by hand.
    this.labelField = createHeaderField({
      caption: 'label',
      placeholder: 'thm:name',
      icon: 'tag',
      mono: true,
      value: (this.node.attrs.label as string | null) ?? null,
      title: 'Reference name for \\ref and \\cref',
      onCommit: (value) => this.setAttr({ label: value }),
      onDone: () => this.view.focus()
    })
    this.labelField.dom.classList.add('theorem-head__label')

    this.head.append(
      this.kindPicker.dom,
      this.numberSlot,
      rule,
      this.nameField.dom,
      spacer,
      this.labelField.dom
    )

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

    this.kindPicker.setValue(kind)

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

    // Each field ignores this while it holds the caret, so a rename in
    // progress is never redrawn out from under the author.
    this.nameField.setValue(title)
    this.labelField.setValue(label)
  }

  private setAttr(patch: Record<string, unknown>): void {
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch })
    )
  }

  // ── The kind picker ────────────────────────────────────────────────────

  private buildKindPicker(): Dropdown {
    const kind = (this.node.attrs.kind as string) || 'theorem'
    const picker = createDropdown({
      className: 'theorem-head__kind',
      title: 'Environment',
      menuMinWidth: 150,
      value: kind,
      options: [optionFor(kind)],
      onChange: (next) => this.setAttr({ kind: next })
    })
    // The full list is filled in on first interaction: working out which kinds
    // are available means walking the document, and doing that once per
    // theorem at load time would cost O(theorems × document). `pointerdown`
    // runs before the button's own `mousedown` opens the menu.
    picker.dom.addEventListener('pointerdown', () => this.loadKinds())
    return picker
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
    this.kindPicker.setOptions([...kinds].sort().map(optionFor))
  }

  // ── ProseMirror plumbing ───────────────────────────────────────────────

  stopEvent(event: Event): boolean {
    // Everything in the header is chrome; ProseMirror should keep its hands
    // off the keystrokes and clicks that land there.
    return event.target instanceof Node && this.head.contains(event.target)
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Our own `data-*` bookkeeping, and anything the header does to itself —
    // including a selection landing in one of its fields.
    if (mutation.type === 'attributes' && mutation.target === this.dom) return true
    return this.head.contains(mutation.target)
  }

  destroy(): void {
    // The theorem can be torn down with a half-typed name still in the field;
    // write it out rather than dropping it. `setAttr` bails when the node has
    // genuinely gone away.
    this.nameField.commit()
    this.labelField.commit()
    // The menu is portalled onto `document.body`, so it outlives the node view
    // unless it's told not to.
    this.kindPicker.destroy()
    this.unsubscribe()
  }
}

function optionFor(kind: string): DropdownOption {
  return { value: kind, label: kind.charAt(0).toUpperCase() + kind.slice(1) }
}

export const theoremNodeView: NodeViewConstructor = (node, view, getPos) =>
  new TheoremView(node, view, getPos)
