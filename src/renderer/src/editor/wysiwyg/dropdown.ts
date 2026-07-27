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
// lives inside ProseMirror node views.
//
// The list is mounted on `document.body` and positioned `fixed`. Keeping it
// inside the control was the obvious thing and it doesn't survive contact
// with where this is used: the formula editor sits inside the scrolling
// editor pane, which clips its overflow, so an open list was cut off at the
// pane's edge — and the taller the list, the worse. Portalling is safe here
// only because nothing in this control ever takes focus (every `mousedown`
// is prevented), so the formula editor's "focus left my subtree, I'm done"
// rule never fires because of us.

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

  root.appendChild(button)
  document.body.appendChild(menu)

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
    if (!next) {
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      return
    }
    active = Math.max(0, options.options.findIndex((o) => o.value === value))
    renderMenu()
    position()
    // A fixed menu doesn't follow its button, so scrolling the pane out from
    // under it would leave the list floating over unrelated text.
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
  }

  /**
   * Put the list next to its button, above it when there isn't room below,
   * and capped to the room actually available on whichever side won — so it
   * scrolls rather than running off the edge of the window.
   */
  function position(): void {
    const MARGIN = 8
    const GAP = 4
    const rect = button.getBoundingClientRect()

    menu.style.maxHeight = ''
    menu.style.minWidth = `${Math.max(200, rect.width)}px`
    // Measured while laid out but not yet painted, so a stale cap from a
    // previous opening can't decide which side this one goes on.
    menu.style.visibility = 'hidden'
    const wanted = menu.offsetHeight
    const width = menu.offsetWidth

    const below = window.innerHeight - rect.bottom - GAP - MARGIN
    const above = rect.top - GAP - MARGIN
    const up = below < wanted && above > below

    menu.style.top = up ? `${Math.max(MARGIN, rect.top - GAP - wanted)}px` : `${rect.bottom + GAP}px`
    menu.style.maxHeight = `${Math.max(120, up ? above : below)}px`
    menu.style.left = `${Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN))}px`
    menu.style.visibility = ''
  }

  const onViewportChange = (): void => setOpen(false)

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
  const onKeyDown = (event: KeyboardEvent): void => {
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
  }
  root.addEventListener('keydown', onKeyDown)
  menu.addEventListener('keydown', onKeyDown)

  const onDocumentDown = (event: MouseEvent): void => {
    if (!open) return
    const target = event.target as Node
    // The list lives on `document.body`, so "inside the control" is now two
    // elements rather than one subtree.
    if (root.contains(target) || menu.contains(target)) return
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
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      // The menu is not inside `root` any more, so it has to go separately —
      // otherwise closing a formula leaves its environment list on the page.
      menu.remove()
      root.remove()
    }
  }
}
