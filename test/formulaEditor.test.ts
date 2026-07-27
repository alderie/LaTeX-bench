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

    it('grows the grid the caret is in, not the formula around it', () => {
      const { field } = open('\\[\n  A + \\begin{pmatrix} a & b \\end{pmatrix}\n\\]')
      const caret = field.value.indexOf('b') + 1
      field.setSelectionRange(caret, caret)
      press(field, 'Tab')
      expect(field.value).toBe('A + \\begin{pmatrix} a & b & \\end{pmatrix}')
    })

    it('has no row or column buttons on the bar', () => {
      // Growing a grid is part of walking it now: Tab past the last cell, or
      // Enter past the last row. The buttons were from when the source area
      // was the only way in.
      const { editor } = open(MATRIX)
      expect(editor.dom.querySelectorAll('.block-editor__button')).toHaveLength(0)
    })
  })

  describe('editing cells in the rendering', () => {
    const MATRIX = '\\[\n  H = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n\\]'

    /**
     * The cells of the typeset formula, in reading order — which is not the
     * order they appear in the DOM, since KaTeX emits a table column by
     * column.
     */
    function cells(editor: FormulaEditor): HTMLElement[] {
      const at = (cell: HTMLElement): number =>
        Number(cell.dataset.cellRow) * 100 + Number(cell.dataset.cellColumn)
      return [
        ...editor.dom.querySelectorAll<HTMLElement>('.block-editor__preview [data-cell-from]')
      ].sort((a, b) => at(a) - at(b))
    }

    /** Click a cell the way a pointer does: mousedown, which is what opens it. */
    function click(cell: HTMLElement): void {
      cell.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    }

    function cellField(editor: FormulaEditor): HTMLInputElement {
      return editor.dom.querySelector('.cell-editor input') as HTMLInputElement
    }

    function type(field: HTMLInputElement, value: string): void {
      field.value = value
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
    }

    it('offers a cell for every entry of a matrix inside a larger formula', () => {
      // A matrix with maths either side of it is the common case, and the
      // one the old separate grid view had nothing to say about.
      const { editor } = open(MATRIX)
      expect(cells(editor).map((cell) => cell.textContent)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('opens a field over the cell that was clicked', () => {
      const { editor } = open(MATRIX)
      click(cells(editor)[1])
      expect(cellField(editor)?.value).toBe('b')
    })

    it('writes what is typed into the source as it is typed', () => {
      const { editor, field } = open(MATRIX)
      click(cells(editor)[1])
      type(cellField(editor), 'x^2')
      expect(field.value).toBe('H = \\begin{pmatrix} a & x^2 \\\\ c & d \\end{pmatrix}')
    })

    it('commits the formula with the cell edit in it', () => {
      const { editor, field, commit } = open(MATRIX)
      click(cells(editor)[3])
      type(cellField(editor), '0')
      press(field, 'Enter', { metaKey: true })
      expect(commit).toHaveBeenCalledWith(expect.stringContaining('c & 0'))
    })

    it('walks the grid on Tab', () => {
      const { editor } = open(MATRIX)
      click(cells(editor)[0])
      press(cellField(editor), 'Tab')
      expect(cellField(editor).value).toBe('b')
    })

    it('grows the matrix when Tab runs out of cells', () => {
      const { editor, field } = open(MATRIX)
      click(cells(editor)[3])
      press(cellField(editor), 'Tab')
      expect(field.value).toContain('a & b &')
      expect(field.value).toContain('c & d &')
    })

    it('puts a cell back on Escape without abandoning the formula', () => {
      const { editor, field, cancel } = open(MATRIX)
      click(cells(editor)[0])
      type(cellField(editor), 'nonsense')
      press(cellField(editor), 'Escape')
      expect(field.value).toContain('a & b')
      expect(cancel).not.toHaveBeenCalled()
    })

    it('adds a row to the matrix, not to the formula around it', () => {
      // A whole-body rewrite put the row break between `H =` and the
      // matrix, which is a parse error rather than a row.
      const { editor, field } = open(MATRIX)
      click(cells(editor)[2])
      press(cellField(editor), 'Enter')
      expect(field.value).toBe('H = \\begin{pmatrix} a & b \\\\ c & d \\\\\n & \\end{pmatrix}')
      expect(cellField(editor).value).toBe('')
    })
  })

  describe('undo', () => {
    const MATRIX = '\\[\n  H = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n\\]'

    function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
      field.value = value
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
    }

    function undo(editor: FormulaEditor): void {
      press(editor.dom, 'z', { metaKey: true })
    }

    function redo(editor: FormulaEditor): void {
      press(editor.dom, 'z', { metaKey: true, shiftKey: true })
    }

    it('puts back what was typed in the source', () => {
      const { editor, field } = open()
      type(field, 'a = b')
      undo(editor)
      expect(field.value).toBe('D_\\psi(x, y) \\coloneqq \\psi(x) - \\psi(y)')
      redo(editor)
      expect(field.value).toBe('a = b')
    })

    it('puts back a cell edited in the rendering', () => {
      // The edit the field's own undo could never see: the cell writes to it
      // by assignment, which is exactly what clears the native undo stack.
      const { editor, field } = open(MATRIX)
      const cell = editor.dom.querySelector('[data-cell-from]') as HTMLElement
      cell.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const input = editor.dom.querySelector('.cell-editor input') as HTMLInputElement
      type(input, 'z^2')
      expect(field.value).toContain('z^2')
      undo(editor)
      expect(field.value).toBe('H = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
    })

    it('puts back a row added to a matrix', () => {
      const { editor, field } = open(MATRIX)
      const before = field.value
      field.setSelectionRange(field.value.length, field.value.length)
      press(field, 'Tab')
      expect(field.value).not.toBe(before)
      undo(editor)
      expect(field.value).toBe(before)
    })

    it('puts back an environment switch, dropdown and all', () => {
      const { editor, field } = open()
      chooseEnv(editor, 'align')
      expect(field.value).toContain('&')
      undo(editor)
      expect(field.value).toBe('D_\\psi(x, y) \\coloneqq \\psi(x) - \\psi(y)')
      const button = editor.dom.querySelector('.ui-dropdown__button') as HTMLElement
      expect(button.textContent).toContain('Equation')
    })

    it('commits what the undo left, not what was typed before it', () => {
      const { editor, field, commit } = open()
      type(field, 'a = b')
      undo(editor)
      press(field, 'Enter', { metaKey: true })
      expect(commit).toHaveBeenCalledWith(EQUATION)
    })

    it('leaves the block alone when there is nothing left to undo', () => {
      const { editor, cancel, commit } = open()
      undo(editor)
      expect(cancel).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
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
