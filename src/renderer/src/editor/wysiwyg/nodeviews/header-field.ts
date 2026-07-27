// A named text field for a block's header bar.
//
// The theorem header used to build its own: the title was a button that
// swapped itself for an `<input>` on click, and an untitled theorem showed a
// separate "+ name" button that did the same thing with different markup. So
// one piece of metadata had three DOM shapes and three sets of styles, and
// none of them agreed on a height — which is why the field sat a few pixels
// off the rest of the header while it was open.
//
// This is one shape for all of it, borrowed from the formula editor's label
// field, which reads well: a caption while the field is empty, the value once
// it has one, and chrome only under the pointer or the caret. The field is a
// `<label>`, so the caption is a click target for the input it names.
//
// Plain DOM, like the rest of `wysiwyg/`: these live inside ProseMirror node
// views, where a React root between a keystroke and its repaint is a stutter.

import { createIcon, type IconName } from '../icons'

export interface HeaderFieldOptions {
  /** Shown in place of the value while the field is empty and unfocused. */
  caption: string
  /** Shown inside the field once it has focus but no value. */
  placeholder?: string
  icon?: IconName
  /** For values that are identifiers rather than prose — labels, keys. */
  mono?: boolean
  value: string | null
  title?: string
  /** The new value, or null when the field was cleared. */
  onCommit: (value: string | null) => void
  /** The author finished with Enter or Escape; hand focus back. */
  onDone?: () => void
}

export interface HeaderField {
  readonly dom: HTMLElement
  readonly input: HTMLInputElement
  /** Reflect a value set elsewhere. Ignored while the field has the caret. */
  setValue: (value: string | null) => void
  /** Write out whatever is typed but not yet committed. */
  commit: () => void
  focus: () => void
}

export function createHeaderField(options: HeaderFieldOptions): HeaderField {
  let committed = (options.value ?? '').trim()

  const wrap = document.createElement('label')
  wrap.className = 'head-field'
  if (options.mono) wrap.classList.add('head-field--mono')
  if (options.title) wrap.title = options.title

  if (options.icon) wrap.appendChild(createIcon(options.icon, 11))

  const caption = document.createElement('span')
  caption.className = 'head-field__caption'
  caption.textContent = options.caption
  wrap.appendChild(caption)

  // The field grows with what's in it. A fixed width is wrong in both
  // directions here — theorem names run from one word to most of a line —
  // so the box is a one-cell grid holding the input and an invisible copy of
  // its value, and the copy is what sets the column's width.
  const box = document.createElement('span')
  box.className = 'head-field__box'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'head-field__input'
  input.value = committed
  input.placeholder = options.placeholder ?? ''
  input.spellcheck = false
  input.autocomplete = 'off'
  box.appendChild(input)
  wrap.appendChild(box)

  const reflect = (): void => {
    box.dataset.value = input.value
    wrap.classList.toggle('head-field--set', input.value.trim() !== '')
  }
  reflect()

  const commit = (): void => {
    const next = input.value.trim()
    if (next === committed) return
    committed = next
    options.onCommit(next === '' ? null : next)
  }

  input.addEventListener('input', reflect)
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      options.onDone?.()
      input.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      input.value = committed
      reflect()
      options.onDone?.()
      input.blur()
    }
    // Everything typed in a header is chrome, not prose: no keymap above
    // this should see it.
    event.stopPropagation()
  })

  return {
    dom: wrap,
    input,
    setValue(value: string | null) {
      // Never redraw the field out from under someone typing in it — the
      // document's own attributes are what they are in the middle of changing.
      if (document.activeElement === input) return
      committed = (value ?? '').trim()
      input.value = committed
      reflect()
    },
    commit,
    focus() {
      input.focus()
      input.select()
    }
  }
}
