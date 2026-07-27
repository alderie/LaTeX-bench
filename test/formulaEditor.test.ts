import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FormulaEditor } from '@renderer/editor/wysiwyg/editors/formula-editor'

// The formula editor's job is to show the author their maths and nothing
// else, then put the wrapper back exactly as it was. These tests drive it
// through the DOM the way typing does.

const EQUATION = `\\begin{equation}
  \\label{eq:bregman}
  D_\\psi(x, y) \\coloneqq \\psi(x) - \\psi(y)
\\end{equation}`

interface Harness {
  editor: FormulaEditor
  field: HTMLTextAreaElement
  commit: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function open(latex = EQUATION, displayMode = true): Harness {
  const commit = vi.fn()
  const cancel = vi.fn()
  const editor = new FormulaEditor({ latex, displayMode, onCommit: commit, onCancel: cancel })
  document.body.appendChild(editor.dom)
  const field = editor.dom.querySelector('textarea') as HTMLTextAreaElement
  return { editor, field, commit, cancel }
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

/** Open the custom environment list and click an option, as a pointer would. */
function chooseEnv(editor: FormulaEditor, value: string): void {
  const down = (): MouseEvent =>
    new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  const button = editor.dom.querySelector('.ui-dropdown__button') as HTMLButtonElement
  button.dispatchEvent(down())
  // Searched from the document, not the editor: the list is mounted on
  // `document.body` so the scrolling editor pane can't clip it.
  // Matched in JS rather than by attribute selector: the values include `\[`,
  // and jsdom's global has no CSS.escape to make that safe to interpolate.
  const option = [...document.querySelectorAll('.ui-dropdown__option')].find(
    (row) => (row as HTMLElement).dataset.value === value
  ) as HTMLElement
  option.dispatchEvent(down())
}

describe('formula editor', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the maths without the wrapper or the indentation', () => {
    const { field } = open()
    expect(field.value).toBe('D_\\psi(x, y) \\coloneqq \\psi(x) - \\psi(y)')
  })

  it('puts the label in a field rather than in the text', () => {
    const { editor, field } = open()
    expect(field.value).not.toContain('\\label')
    const label = editor.dom.querySelector('.block-editor__label-input') as HTMLInputElement
    expect(label.value).toBe('eq:bregman')
  })

  it('returns the original source byte for byte when nothing was touched', () => {
    // Reformatting a formula just because it was opened shows up as a
    // spurious edit in the saved .tex.
    const { field, commit } = open()
    press(field, 'Enter', { metaKey: true })
    expect(commit).toHaveBeenCalledWith(EQUATION)
  })

  it('writes an edit back inside the original wrapper', () => {
    const { field, commit } = open()
    field.value = 'a = b'
    press(field, 'Enter', { metaKey: true })
    expect(commit).toHaveBeenCalledWith('\\begin{equation}\n  \\label{eq:bregman}\n  a = b\n\\end{equation}')
  })

  it('unnumbers an equation from the dropdown, not by retyping', () => {
    const { editor, field, commit } = open()
    chooseEnv(editor, 'equation*')
    press(field, 'Enter', { metaKey: true })

    const [source] = commit.mock.calls[0]
    expect(source).toContain('\\begin{equation*}')
    expect(source).toContain('\\end{equation*}')
    expect(source).toContain('D_\\psi(x, y)')
  })

  it('renames the label from the field', () => {
    const { editor, field, commit } = open()
    const label = editor.dom.querySelector('.block-editor__label-input') as HTMLInputElement
    label.value = 'eq:divergence'
    label.dispatchEvent(new window.Event('input'))
    press(field, 'Enter', { metaKey: true })

    const [source] = commit.mock.calls[0]
    expect(source).toContain('\\label{eq:divergence}')
    expect(source).not.toContain('eq:bregman')
  })

  it('throws the edit away on Escape', () => {
    const { field, commit, cancel } = open()
    field.value = 'nonsense \\notamacro'
    press(field, 'Escape')
    expect(cancel).toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('finishes only once even if blur follows the keystroke', () => {
    const { field, commit } = open()
    press(field, 'Enter', { metaKey: true })
    field.dispatchEvent(new window.Event('blur'))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  describe('grid navigation', () => {
    const MATRIX = '\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}'

    it('moves the caret to the next cell on Tab', () => {
      // Tab used to splice a literal ` & ` in wherever the caret happened
      // to be, which in the middle of a cell split it in two.
      const { field } = open(MATRIX)
      field.setSelectionRange(0, 0)
      press(field, 'Tab')
      expect(field.selectionStart).toBeGreaterThan(0)
      expect(field.value).toBe('a &= b \\\\\nc &= d')
    })

    it('grows the grid when Tab runs out of cells', () => {
      const { field } = open(MATRIX)
      field.setSelectionRange(field.value.length, field.value.length)
      press(field, 'Tab')
      expect(field.value.split('&').length).toBeGreaterThan(MATRIX.split('&').length)
    })

    it('adds a row from the toolbar', () => {
      const { editor, field } = open(MATRIX)
      const [addRow] = editor.dom.querySelectorAll('.block-editor__button')
      ;(addRow as HTMLButtonElement).click()
      expect(field.value.split('\\\\').length).toBe(3)
    })

    it('dims the grid controls for a formula that has no grid', () => {
      // Dimmed rather than hidden: removing them would make the bar jump
      // every time a matrix is typed or deleted.
      const { editor } = open()
      const controls = editor.dom.querySelector('.block-editor__grid')
      expect(controls?.classList.contains('block-editor__grid--off')).toBe(true)
    })

    it('enables the grid controls for a formula that has one', () => {
      const { editor } = open(MATRIX)
      const controls = editor.dom.querySelector('.block-editor__grid')
      expect(controls?.classList.contains('block-editor__grid--off')).toBe(false)
    })

    it('enables them as soon as a matrix is typed into a plain equation', () => {
      const { editor, field } = open()
      field.value = '\\begin{pmatrix} a & b \\end{pmatrix}'
      field.dispatchEvent(new window.Event('input'))
      const controls = editor.dom.querySelector('.block-editor__grid')
      expect(controls?.classList.contains('block-editor__grid--off')).toBe(false)
    })
  })

  describe('the environment list', () => {
    it('is mounted outside the editor so nothing can clip it', () => {
      // The formula editor sits inside the scrolling editor pane, which
      // clips its overflow: an in-place list was cut off at the pane's edge.
      const { editor } = open()
      const button = editor.dom.querySelector('.ui-dropdown__button') as HTMLButtonElement
      button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const menu = document.querySelector('.ui-dropdown__menu') as HTMLElement
      expect(menu.hidden).toBe(false)
      expect(editor.dom.contains(menu)).toBe(false)
      expect(menu.parentElement).toBe(document.body)
    })

    it('goes away with the editor rather than being left on the page', () => {
      const { editor } = open()
      const button = editor.dom.querySelector('.ui-dropdown__button') as HTMLButtonElement
      button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      expect(document.querySelector('.ui-dropdown__menu')).not.toBeNull()
      editor.destroy()
      expect(document.querySelector('.ui-dropdown__menu')).toBeNull()
    })

    it('closes when a click lands outside both the button and the list', () => {
      const { editor } = open()
      const button = editor.dom.querySelector('.ui-dropdown__button') as HTMLButtonElement
      button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
      expect((document.querySelector('.ui-dropdown__menu') as HTMLElement).hidden).toBe(true)
    })
  })

  describe('inline math', () => {
    it('edits the source directly, with no wrapper to strip', () => {
      const { editor } = open('x^2 + y^2', false)
      const field = editor.dom.querySelector('input') as HTMLInputElement
      expect(field.value).toBe('x^2 + y^2')
    })

    it('commits on plain Enter, since there are no lines to break', () => {
      const commit = vi.fn()
      const editor = new FormulaEditor({
        latex: 'x',
        displayMode: false,
        onCommit: commit,
        onCancel: vi.fn()
      })
      document.body.appendChild(editor.dom)
      const field = editor.dom.querySelector('input') as HTMLInputElement
      field.value = 'x + 1'
      press(field, 'Enter')
      expect(commit).toHaveBeenCalledWith('x + 1')
    })
  })
})
