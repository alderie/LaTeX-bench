// A select control the app can actually style.
//
// A native `<select>` renders its list with the OS, which means the popup
// ignores every token in this app — it is light while the editor is dark, it
// uses the system font, and it cannot show an icon beside an option. In a
// formula editor where the choice *is* "which shape does this maths take",
// the icon is the fastest part of the row to read, so the list is rebuilt
// here from plain DOM.
//
// Plain DOM (not React) for the same reason as the rest of `wysiwyg/`: this
// lives inside ProseMirror node views, and the menu is deliberately mounted
// *inside* its own element rather than on `document.body` — the formula
// editor decides it is finished when focus leaves its subtree, and a menu
// portalled to the body would look like leaving.

import { createIcon, hasIcon, type IconName } from './icons'

export interface DropdownOption {
  value: string
  label: string
  /** Glyph shown in the button and beside the option. */
  icon?: string
  /** Quiet right-hand note, e.g. "numbered". */
  hint?: string
}

export interface DropdownOptions {
  options: DropdownOption[]
  value: string
  /** Extra class on the root, for callers that need to size it. */
  className?: string
  /** Tooltip and accessible name for the button. */
  title?: string
  onChange: (value: string) => void
}

export interface Dropdown {
  readonly dom: HTMLElement
  /** Reflect a value chosen elsewhere, without firing `onChange`. */
  setValue: (value: string) => void
  close: () => void
  destroy: () => void
}

export function createDropdown(options: DropdownOptions): Dropdown {
  let value = options.value
  let open = false
  let active = Math.max(0, options.options.findIndex((o) => o.value === value))

  const root = document.createElement('div')
  root.className = 'ui-dropdown' + (options.className ? ` ${options.className}` : '')

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ui-dropdown__button'
  button.setAttribute('aria-haspopup', 'listbox')
  if (options.title) {
    button.title = options.title
    button.setAttribute('aria-label', options.title)
  }

  const menu = document.createElement('div')
  menu.className = 'ui-dropdown__menu'
  menu.setAttribute('role', 'listbox')
  menu.hidden = true

  root.append(button, menu)

  function current(): DropdownOption | undefined {
    return options.options.find((o) => o.value === value)
  }

  function renderButton(): void {
    button.replaceChildren()
    const option = current()
    if (option?.icon && hasIcon(option.icon)) {
      button.appendChild(createIcon(option.icon as IconName, 13))
    }
    const label = document.createElement('span')
    label.className = 'ui-dropdown__value'
    label.textContent = option?.label ?? value
    button.appendChild(label)
    button.appendChild(createIcon('chevronDown', 12))
  }

  function renderMenu(): void {
    menu.replaceChildren()
    options.options.forEach((option, index) => {
      const row = document.createElement('div')
      row.className = 'ui-dropdown__option'
      row.setAttribute('role', 'option')
      row.dataset.value = option.value
      row.setAttribute('aria-selected', String(option.value === value))
      if (option.value === value) row.classList.add('ui-dropdown__option--selected')
      if (index === active) row.classList.add('ui-dropdown__option--active')

      const glyph = document.createElement('span')
      glyph.className = 'ui-dropdown__icon'
      if (option.icon && hasIcon(option.icon)) {
        glyph.appendChild(createIcon(option.icon as IconName, 14))
      }
      row.appendChild(glyph)

      const label = document.createElement('span')
      label.className = 'ui-dropdown__label'
      label.textContent = option.label
      row.appendChild(label)

      if (option.hint) {
        const hint = document.createElement('span')
        hint.className = 'ui-dropdown__hint'
        hint.textContent = option.hint
        row.appendChild(hint)
      }

      // mousedown, and prevented: the caller's field must keep focus, or the
      // surrounding editor treats the click as "the author moved on".
      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        choose(index)
      })
      row.addEventListener('mouseenter', () => {
        active = index
        highlight()
      })
      menu.appendChild(row)
    })
  }

  function highlight(): void {
    menu.querySelectorAll('.ui-dropdown__option').forEach((row, i) => {
      row.classList.toggle('ui-dropdown__option--active', i === active)
    })
  }

  function choose(index: number): void {
    const option = options.options[index]
    if (!option) return
    setOpen(false)
    if (option.value === value) return
    value = option.value
    renderButton()
    options.onChange(value)
  }

  function setOpen(next: boolean): void {
    if (open === next) return
    open = next
    menu.hidden = !next
    root.classList.toggle('ui-dropdown--open', next)
    button.setAttribute('aria-expanded', String(next))
    if (next) {
      active = Math.max(0, options.options.findIndex((o) => o.value === value))
      renderMenu()
      // Flip above the button when there isn't room below it — the bar sits
      // near the bottom of the viewport as often as not.
      const rect = button.getBoundingClientRect()
      const room = window.innerHeight - rect.bottom
      root.classList.toggle('ui-dropdown--up', room < menu.offsetHeight + 16)
    }
  }

  function move(direction: 1 | -1): void {
    const count = options.options.length
    active = (active + direction + count) % count
    highlight()
    menu.children[active]?.scrollIntoView({ block: 'nearest' })
  }

  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    setOpen(!open)
  })

  // The button never takes focus (see the mousedown above), so keys arrive
  // here by bubbling from whatever the caller left focused. Only intercept
  // them while the list is showing.
  root.addEventListener('keydown', (event) => {
    if (!open) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(active)
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        break
    }
  })

  const onDocumentDown = (event: MouseEvent): void => {
    if (!open) return
    if (root.contains(event.target as Node)) return
    setOpen(false)
  }
  document.addEventListener('mousedown', onDocumentDown, true)

  renderButton()

  return {
    dom: root,
    setValue(next: string) {
      if (next === value) return
      value = next
      renderButton()
      if (open) renderMenu()
    },
    close() {
      setOpen(false)
    },
    destroy() {
      document.removeEventListener('mousedown', onDocumentDown, true)
      root.remove()
    }
  }
}
