// The chrome every in-place editor in the paper shares.
//
// It started as the formula editor's own furniture: a bar of controls above
// the source, a hint saying which keys finish the edit, a delete button at
// the far end, and a live preview underneath. That shape is not specific to
// maths — a table wants exactly the same thing, and so does the preamble —
// but it was written into `formula-editor.ts`, so opening a table gave you a
// bare textarea with none of it. The two surfaces sat next to each other in
// the same document looking like they came from different applications.
//
// So the furniture lives here and the editors are what differ: which controls
// go on the bar, what the body is, and whether there is anything worth
// previewing.
//
// Plain DOM, like the rest of `wysiwyg/`: these are built inside ProseMirror
// node views, where a React root between a keystroke and its repaint shows up
// as a stutter on a long formula.

import { createIcon, type IconName } from '../icons'

/** What ⌘⏎ and Escape do, said once so every surface says it the same way. */
export const COMMIT_HINT = '⌘⏎ done · esc revert'

export interface EditorPanelOptions {
  /** Modifier class: `formula`, `tabular`, `preamble`, `raw`. */
  variant: string
  /** Flows inline in a paragraph (inline maths) — no bar, no preview. */
  inline?: boolean
  /** Right-aligned keyboard reminder. Defaults to `COMMIT_HINT`. */
  hint?: string | null
  /**
   * Remove the whole block. Offered on the bar because the margin handle that
   * deletes a block is unreachable while its editor is open — the editor is
   * what's under the pointer.
   */
  onDelete?: () => void
  deleteTitle?: string
}

export class EditorPanel {
  readonly dom: HTMLElement
  /** The control strip, or null for an inline panel. */
  readonly bar: HTMLElement | null = null
  /** Where the editing surface goes. */
  readonly body: HTMLElement
  private spacer: HTMLElement | null = null
  private preview: HTMLElement | null = null

  constructor(options: EditorPanelOptions) {
    this.dom = document.createElement('div')
    this.dom.className = options.inline
      ? `block-editor block-editor--inline block-editor--${options.variant}`
      : `block-editor block-editor--${options.variant}`

    this.body = document.createElement('div')
    this.body.className = 'block-editor__body'

    if (options.inline) {
      // An inline editor is a chip on the prose baseline; a bar over it would
      // be taller than the line it sits in.
      this.dom.appendChild(this.body)
      return
    }

    this.bar = document.createElement('div')
    this.bar.className = 'block-editor__bar'

    this.spacer = document.createElement('span')
    this.spacer.className = 'block-editor__spacer'
    this.bar.appendChild(this.spacer)

    const hint = options.hint === undefined ? COMMIT_HINT : options.hint
    if (hint) {
      const el = document.createElement('span')
      el.className = 'block-editor__hint'
      el.textContent = hint
      this.bar.appendChild(el)
    }

    if (options.onDelete) {
      const title = options.deleteTitle ?? 'Delete this block'
      const remove = panelButton('trash', title, options.onDelete)
      remove.classList.add('block-editor__button--danger')
      this.bar.appendChild(remove)
    }

    this.dom.append(this.bar, this.body)
  }

  /** Add a control to the left-hand run of the bar, in call order. */
  addControl(element: HTMLElement): void {
    if (!this.bar || !this.spacer) return
    this.bar.insertBefore(element, this.spacer)
  }

  /**
   * The panel's live rendering, under the source. Created on first use, so a
   * surface with nothing to preview doesn't carry an empty strip.
   */
  previewHost(): HTMLElement {
    if (!this.preview) {
      this.preview = document.createElement('div')
      this.preview.className = 'block-editor__preview'
      this.dom.appendChild(this.preview)
    }
    return this.preview
  }
}

/**
 * A bar button.
 *
 * `mousedown` is prevented on every one of these: without it the press blurs
 * the field, the surrounding editor reads that as "the author moved on" and
 * commits, and the click lands on a panel that is already gone.
 */
export function panelButton(
  icon: IconName,
  title: string,
  onClick: () => void,
  options: { plus?: boolean } = {}
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'block-editor__button'
  button.title = title
  button.setAttribute('aria-label', title)
  button.appendChild(createIcon(icon, 14))
  if (options.plus) button.appendChild(createIcon('plus', 10))
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', onClick)
  return button
}

/**
 * A two-state control on the bar, labelled with text rather than a glyph.
 *
 * For the settings that are a yes/no about the block rather than a command:
 * "is this numbered". A pressed toggle has to look pressed rather than
 * hovered, so it carries its own modifier class instead of borrowing the
 * button's.
 */
export function panelToggle(
  text: string,
  title: (pressed: boolean) => string,
  pressed: boolean,
  onChange: (next: boolean) => void
): { dom: HTMLButtonElement; set: (next: boolean) => void } {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'block-editor__toggle'
  button.textContent = text

  let state = pressed
  const set = (next: boolean): void => {
    state = next
    button.classList.toggle('block-editor__toggle--on', state)
    button.setAttribute('aria-pressed', String(state))
    button.title = title(state)
    button.setAttribute('aria-label', title(state))
  }
  set(pressed)

  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => onChange(!state))
  return { dom: button, set }
}

/** A static name on the bar, for a block whose kind isn't a choice. */
export function panelName(text: string): HTMLElement {
  const name = document.createElement('span')
  name.className = 'block-editor__name'
  name.textContent = text
  return name
}

/** A quiet note on the bar — a line count, a shape, a warning. */
export function panelNote(text: string): HTMLElement {
  const note = document.createElement('span')
  note.className = 'block-editor__note'
  note.textContent = text
  return note
}

export interface FinishOptions {
  commit: () => void
  cancel: () => void
  /** True once the edit has ended, so late events don't finish it twice. */
  isFinished: () => boolean
  /** Delete the block — Backspace in an empty field. */
  onDelete?: () => void
  /** Return true to let a key through untouched (an open suggestion list). */
  intercept?: (event: KeyboardEvent) => boolean
}

/**
 * Wire the keys and the blur that end an edit.
 *
 * On the panel's subtree rather than on the field: a dropdown on the bar, a
 * label field, a cell of a grid are all still "editing this block", and a
 * per-field handler would have to enumerate them.
 */
export function bindFinishKeys(
  panel: EditorPanel,
  field: HTMLTextAreaElement | HTMLInputElement,
  options: FinishOptions
): void {
  panel.dom.addEventListener('keydown', (event) => {
    if (options.intercept?.(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      options.cancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      options.commit()
      return
    }
    // Backspace with nothing left to delete takes the block itself. The
    // keymap that does this for every other block can't see a key pressed in
    // here — the field is chrome, not part of the document.
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      event.target === field &&
      field.value === '' &&
      options.onDelete
    ) {
      event.preventDefault()
      options.onDelete()
    }
  })

  panel.dom.addEventListener('focusout', () => {
    // Focus moving to a control on the bar is still editing this block, and
    // the browser reports the new `activeElement` only after the event.
    requestAnimationFrame(() => {
      if (options.isFinished()) return
      if (panel.dom.contains(document.activeElement)) return
      options.commit()
    })
  })
}
