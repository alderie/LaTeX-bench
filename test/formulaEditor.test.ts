import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FormulaEditor } from '@renderer/editor/wysiwyg/nodeviews/formula-editor'

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
    const label = editor.dom.querySelector('.formula-editor__label-input') as HTMLInputElement
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
    const select = editor.dom.querySelector('.formula-editor__env') as HTMLSelectElement
    select.value = 'equation*'
    select.dispatchEvent(new window.Event('change'))
    press(field, 'Enter', { metaKey: true })

    const [source] = commit.mock.calls[0]
    expect(source).toContain('\\begin{equation*}')
    expect(source).toContain('\\end{equation*}')
    expect(source).toContain('D_\\psi(x, y)')
  })

  it('renames the label from the field', () => {
    const { editor, field, commit } = open()
    const label = editor.dom.querySelector('.formula-editor__label-input') as HTMLInputElement
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

    it('tabs within the matrix the caret is in, not the whole formula', () => {
      // With two matrices on one line, top-level cell spans belong to the
      // equation and Tab used to jump between the matrices themselves.
      const two = String.raw`\begin{pmatrix}a & b\end{pmatrix} + \begin{pmatrix}c & d\end{pmatrix}`
      const { field } = open(`\\[\n${two}\n\\]`)
      const caret = field.value.indexOf('c')
      field.setSelectionRange(caret, caret)
      press(field, 'Tab')
      expect(field.selectionStart).toBeLessThan(field.value.indexOf('\\end{pmatrix}', caret) + 1)
      expect(field.selectionStart).toBeGreaterThan(caret)
    })

  })

  describe('the grid editor', () => {
    const MATRIX = '\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}'
    const PAIR = String.raw`\begin{equation*}
H = \begin{pmatrix}2 & 1 \\ 1 & 2\end{pmatrix}, \qquad H^{-1} = \begin{pmatrix}2 & -1 \\ -1 & 2\end{pmatrix}
\end{equation*}`

    const cellsOf = (editor: FormulaEditor): HTMLInputElement[] =>
      [...editor.dom.querySelectorAll('.formula-grid__cell')] as HTMLInputElement[]

    it('appears on its own for a formula that has a matrix', () => {
      // It used to be two buttons on the toolbar. Nobody presses a button to
      // find out whether they have a matrix; they can already see that they do.
      const { editor } = open(PAIR)
      expect(editor.dom.querySelectorAll('.formula-grid')).toHaveLength(2)
      expect(cellsOf(editor).map((c) => c.value)).toEqual(['2', '1', '1', '2', '2', '-1', '-1', '2'])
    })

    it('stays away from a formula that has no grid', () => {
      const { editor } = open()
      expect(editor.dom.querySelector('.formula-grid')).toBeNull()
    })

    it('appears as soon as a matrix is typed into a plain equation', () => {
      const { editor, field } = open()
      field.value = '\\begin{pmatrix} a & b \\end{pmatrix}'
      field.dispatchEvent(new window.Event('input'))
      expect(cellsOf(editor).map((c) => c.value)).toEqual(['a', 'b'])
    })

    it('falls back to the environment itself when nothing is nested in it', () => {
      const { editor } = open(MATRIX)
      expect(cellsOf(editor).map((c) => c.value)).toEqual(['a', '= b', 'c', '= d'])
    })

    it('writes a cell edit back into the source', () => {
      const { editor, field } = open(PAIR)
      const cell = cellsOf(editor)[1]
      cell.value = '7'
      cell.dispatchEvent(new window.Event('input'))
      expect(field.value).toContain('\\begin{pmatrix}2 & 7 \\\\ 1 & 2\\end{pmatrix}')
      // The second matrix is a separate region and must not have moved.
      expect(field.value).toContain('\\begin{pmatrix}2 & -1 \\\\ -1 & 2\\end{pmatrix}')
    })

    it('edits the second matrix without disturbing the first', () => {
      const { editor, field } = open(PAIR)
      const cell = cellsOf(editor)[7]
      cell.value = '9'
      cell.dispatchEvent(new window.Event('input'))
      expect(field.value).toContain('\\begin{pmatrix}2 & 1 \\\\ 1 & 2\\end{pmatrix}')
      expect(field.value).toContain('-1 & 9\\end{pmatrix}')
    })

    it('adds a row to the matrix the button belongs to', () => {
      const { editor, field } = open(PAIR)
      const [addRow] = editor.dom.querySelectorAll('.formula-grid__add')
      ;(addRow as HTMLButtonElement).click()
      const [first, second] = field.value.split('\\qquad')
      expect(first.split('\\\\')).toHaveLength(3)
      expect(second.split('\\\\')).toHaveLength(2)
    })

    it('removes a column from the edge control', () => {
      const { editor, field } = open(PAIR)
      const strips = editor.dom.querySelectorAll('.formula-grid__strip--active')
      // Row strips come first (one per row), then the column strips.
      ;(strips[2] as HTMLButtonElement).click()
      expect(field.value).toContain('\\begin{pmatrix} 1 \\\\ 2\\end{pmatrix}')
      // Only the first matrix; the second still has both of its columns.
      expect(field.value).toContain('2 & -1 \\\\ -1 & 2')
    })

    it('keeps the cells in step when the source is edited directly', () => {
      const { editor, field } = open(PAIR)
      field.value = field.value.replace('2 & 1', '5 & 1')
      field.dispatchEvent(new window.Event('input'))
      expect(cellsOf(editor)[0].value).toBe('5')
    })

    it('commits the whole formula on ⌘⏎ from inside a cell', () => {
      const { editor, commit } = open(PAIR)
      const cell = cellsOf(editor)[0]
      cell.value = '4'
      cell.dispatchEvent(new window.Event('input'))
      press(cell, 'Enter', { metaKey: true })
      expect(commit).toHaveBeenCalledTimes(1)
      expect(commit.mock.calls[0][0]).toContain('4 & 1')
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
