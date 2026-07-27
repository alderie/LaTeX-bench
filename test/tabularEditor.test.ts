import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TabularEditor } from '@renderer/editor/wysiwyg/editors/tabular-editor'

// A table opens in the same panel a formula opens in. These tests drive that
// panel through the DOM the way a pointer and a keyboard do.

const TABLE = `\\begin{tabular}{@{}lcc@{}}
  \\toprule
  Method & Acc & Time \\\\
  \\midrule
  SGD & 4.81 & 0.92 \\\\
  \\bottomrule
\\end{tabular}`

interface Harness {
  editor: TabularEditor
  field: HTMLTextAreaElement
  commit: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

function open(source = TABLE): Harness {
  const commit = vi.fn()
  const cancel = vi.fn()
  const remove = vi.fn()
  const editor = new TabularEditor({
    source,
    onCommit: commit,
    onCancel: cancel,
    onDelete: remove
  })
  document.body.appendChild(editor.dom)
  return {
    editor,
    field: editor.dom.querySelector('textarea') as HTMLTextAreaElement,
    commit,
    cancel,
    remove
  }
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('the table editor', () => {
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

  it('wears the same panel as the formula editor', () => {
    // The point of the exercise: a table and an equation in the same document
    // should not look like they came from two different applications.
    const { editor } = open()
    expect(editor.dom.classList.contains('block-editor')).toBe(true)
    expect(editor.dom.querySelector('.block-editor__bar')).not.toBeNull()
    expect(editor.dom.querySelector('.block-editor__hint')?.textContent).toContain('done')
  })

  it('names the environment and the shape on its bar', () => {
    const { editor } = open()
    expect(editor.dom.querySelector('.block-editor__name')?.textContent).toBe('tabular')
    expect(editor.dom.querySelector('.block-editor__note')?.textContent).toBe('2 × 3')
  })

  it('puts the column spec in a field rather than in the text', () => {
    const { editor } = open()
    const spec = editor.dom.querySelector('.head-field__input') as HTMLInputElement
    expect(spec.value).toBe('@{}lcc@{}')
  })

  it('rewrites the source when the column spec is edited', () => {
    const { editor, field } = open()
    const spec = editor.dom.querySelector('.head-field__input') as HTMLInputElement
    spec.value = 'lrr'
    spec.dispatchEvent(new window.Event('blur'))
    expect(field.value).toContain('\\begin{tabular}{lrr}')
    expect(field.value).toContain('SGD & 4.81 & 0.92')
  })

  it('has no row or column buttons on the bar', () => {
    // The table grows as it is walked — Tab past the last cell, Enter past
    // the last row — so the only button left is the one that deletes it.
    const { editor } = open()
    const titles = [...editor.dom.querySelectorAll('.block-editor__button')].map((button) =>
      button.getAttribute('title')
    )
    expect(titles).toEqual(['Delete this table'])
  })

  it('previews the table with the renderer that draws it when closed', () => {
    const { editor } = open()
    const table = editor.dom.querySelector('.block-editor__preview .tabular-block')
    expect(table).not.toBeNull()
    expect(table?.textContent).toContain('Method')
  })

  it('says so when the source stops being a table', () => {
    const { editor, field } = open()
    field.value = '\\begin{tabular}{ll}\n  a & b'
    field.dispatchEvent(new window.Event('input'))
    const preview = editor.dom.querySelector('.block-editor__preview') as HTMLElement
    expect(preview.classList.contains('block-editor__preview--invalid')).toBe(true)
  })

  it('returns the original source byte for byte when nothing was touched', () => {
    // Reformatting a table just because it was opened shows up as a spurious
    // edit in the saved .tex.
    const { field, commit } = open()
    press(field, 'Enter', { metaKey: true })
    expect(commit).toHaveBeenCalledWith(TABLE)
  })

  it('throws the edit away on Escape', () => {
    const { field, commit, cancel } = open()
    field.value = 'nonsense'
    press(field, 'Escape')
    expect(cancel).toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('finishes only once even if blur follows the keystroke', () => {
    const { field, commit } = open()
    press(field, 'Enter', { metaKey: true })
    field.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  describe('editing cells in the rendering', () => {
    function cells(editor: TabularEditor): HTMLElement[] {
      return [...editor.dom.querySelectorAll<HTMLElement>('.block-editor__preview td')]
    }

    function click(cell: HTMLElement): void {
      cell.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    }

    function cellField(editor: TabularEditor): HTMLInputElement {
      return editor.dom.querySelector('.cell-editor input') as HTMLInputElement
    }

    function type(field: HTMLInputElement, value: string): void {
      field.value = value
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
    }

    it('opens a field over the cell that was clicked', () => {
      const { editor } = open()
      click(cells(editor)[4])
      expect(cellField(editor).value).toBe('4.81')
    })

    it('writes the cell back without reformatting the rest of the table', () => {
      // The surgical part: everything the author wrote outside the cell —
      // the rules, the spacing, the column spec — comes back byte for byte.
      const { editor, field } = open()
      click(cells(editor)[4])
      type(cellField(editor), '3.92 \\pm 0.4')
      expect(field.value).toBe(TABLE.replace('4.81', '3.92 \\pm 0.4'))
    })

    it('walks the row on Tab and wraps to the next one', () => {
      const { editor } = open()
      click(cells(editor)[0])
      press(cellField(editor), 'Tab')
      expect(cellField(editor).value).toBe('Acc')
      press(cellField(editor), 'Tab')
      press(cellField(editor), 'Tab')
      expect(cellField(editor).value).toBe('SGD')
    })

    it('drops down a row on Enter', () => {
      const { editor } = open()
      click(cells(editor)[1])
      press(cellField(editor), 'Enter')
      expect(cellField(editor).value).toBe('4.81')
    })

    it('puts a cell back on Escape without abandoning the table', () => {
      const { editor, field, cancel } = open()
      click(cells(editor)[0])
      type(cellField(editor), 'nonsense')
      press(cellField(editor), 'Escape')
      expect(field.value).toBe(TABLE)
      expect(cancel).not.toHaveBeenCalled()
    })

    it('commits the table with the cell edit in it', () => {
      const { editor, commit } = open()
      click(cells(editor)[4])
      type(cellField(editor), '9.9')
      press(cellField(editor), 'Enter', { metaKey: true })
      expect(commit).toHaveBeenCalledWith(TABLE.replace('4.81', '9.9'))
    })

    it('grows the table when Tab runs out of cells', () => {
      const { editor, field } = open()
      click(cells(editor).pop() as HTMLElement)
      press(cellField(editor), 'Tab')
      expect(editor.dom.querySelector('.block-editor__note')?.textContent).toBe('2 × 4')
      expect(field.value).toContain('{@{}lccc@{}}')
    })

    it('adds a row when Enter runs out of rows', () => {
      const { editor } = open()
      click(cells(editor)[3])
      press(cellField(editor), 'Enter')
      expect(editor.dom.querySelector('.block-editor__note')?.textContent).toBe('3 × 3')
      expect(cellField(editor).value).toBe('')
    })

    it('opens a cell by the offset a click on the closed table reports', () => {
      // The rendered table carries the same offsets whether it is being
      // edited or merely read, which is what lets a click on the document's
      // own table land in the cell that was clicked.
      const { editor } = open()
      const from = Number(cells(editor)[2].dataset.cellFrom)
      editor.openCell(from)
      expect(cellField(editor).value).toBe('Time')
    })

    it('edits the content of a spanning cell, not the macro around it', () => {
      const source = `\\begin{tabular}{@{}lcc@{}}
  \\multicolumn{2}{c}{Stable index} & Time \\\\
\\end{tabular}`
      const { editor, field } = open(source)
      click(cells(editor)[0])
      expect(cellField(editor).value).toBe('Stable index')
      type(cellField(editor), 'Tail index')
      expect(field.value).toContain('\\multicolumn{2}{c}{Tail index}')
    })
  })

  describe('undo', () => {
    function undo(editor: TabularEditor): void {
      press(editor.dom, 'z', { metaKey: true })
    }

    it('puts back a cell edited in the rendering', () => {
      const { editor, field } = open()
      const cell = editor.dom.querySelectorAll('.block-editor__preview td')[4] as HTMLElement
      cell.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const input = editor.dom.querySelector('.cell-editor input') as HTMLInputElement
      input.value = '9.9'
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      expect(field.value).not.toBe(TABLE)
      undo(editor)
      expect(field.value).toBe(TABLE)
    })

    it('puts back a column added to the table, spec and all', () => {
      const { editor, field } = open()
      const last = [...editor.dom.querySelectorAll('.block-editor__preview td')].pop() as HTMLElement
      last.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      press(editor.dom.querySelector('.cell-editor input') as HTMLInputElement, 'Tab')
      expect(field.value).toContain('{@{}lccc@{}}')
      undo(editor)
      expect(field.value).toBe(TABLE)
      const spec = editor.dom.querySelector('.head-field__input') as HTMLInputElement
      expect(spec.value).toBe('@{}lcc@{}')
    })

    it('does not let the undo key reach the block and finish it', () => {
      const { editor, commit, cancel } = open()
      undo(editor)
      expect(commit).not.toHaveBeenCalled()
      expect(cancel).not.toHaveBeenCalled()
    })
  })

  it('deletes the block from the bar', () => {
    const { editor, remove } = open()
    const danger = editor.dom.querySelector('.block-editor__button--danger') as HTMLButtonElement
    danger.click()
    expect(remove).toHaveBeenCalled()
  })
})
