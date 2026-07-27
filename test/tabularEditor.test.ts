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

  it('grows the table from the bar', () => {
    const { editor, field } = open()
    const [addRow, addColumn] = editor.dom.querySelectorAll('.block-editor__button')
    ;(addRow as HTMLButtonElement).click()
    expect(editor.dom.querySelector('.block-editor__note')?.textContent).toBe('3 × 3')
    ;(addColumn as HTMLButtonElement).click()
    expect(editor.dom.querySelector('.block-editor__note')?.textContent).toBe('3 × 4')
    expect(field.value).toContain('{@{}lccc@{}}')
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

  it('deletes the block from the bar', () => {
    const { editor, remove } = open()
    const danger = editor.dom.querySelector('.block-editor__button--danger') as HTMLButtonElement
    danger.click()
    expect(remove).toHaveBeenCalled()
  })
})
