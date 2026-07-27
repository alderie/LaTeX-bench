import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { useInlineRename } from '@renderer/hooks/useInlineRename'

// Renaming has to end when the author clicks away. `blur` alone doesn't
// deliver that here: several handlers in this app call `preventDefault()` on
// mousedown so they *don't* steal focus, and a click on any of them used to
// leave the rename field open with the caret still blinking in it.

function attachField(rename: ReturnType<typeof useInlineRename>, value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.value = value
  document.body.appendChild(input)
  rename.inputProps.ref(input)
  return input
}

function pointerDownOn(target: Node): void {
  target.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
}

describe('inline rename', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('commits when the pointer goes down anywhere else', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Old title'))
    const field = attachField(result.current, 'New title')

    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    act(() => pointerDownOn(elsewhere))

    expect(onRename).toHaveBeenCalledWith('New title')
    expect(result.current.editing).toBe(false)
    field.remove()
  })

  it('stays open while the pointer is inside the field', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Old title'))
    const field = attachField(result.current, 'Old title')
    act(() => pointerDownOn(field))

    expect(result.current.editing).toBe(true)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('survives a handler that stops propagation', () => {
    // The listener runs in the capture phase precisely so that a row which
    // swallows the event can't leave the field open behind it.
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Old title'))
    attachField(result.current, 'Renamed')

    const swallower = document.createElement('div')
    swallower.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.body.appendChild(swallower)
    act(() => pointerDownOn(swallower))

    expect(onRename).toHaveBeenCalledWith('Renamed')
  })

  it('renames only once when blur and pointerdown both fire', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Old title'))
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    attachField(result.current, 'Renamed')

    act(() => {
      pointerDownOn(elsewhere)
      result.current.inputProps.onBlur()
    })

    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('does not rename when the text is unchanged', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Same'))
    attachField(result.current, 'Same')
    act(() => result.current.commit())

    expect(onRename).not.toHaveBeenCalled()
    expect(result.current.editing).toBe(false)
  })

  it('refuses to rename a paper to nothing', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Something'))
    attachField(result.current, '   ')
    act(() => result.current.commit())

    expect(onRename).not.toHaveBeenCalled()
  })

  it('throws the edit away on cancel', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Original'))
    attachField(result.current, 'Half-typed')
    act(() => result.current.cancel())

    expect(onRename).not.toHaveBeenCalled()
    expect(result.current.editing).toBe(false)
  })

  it('stops listening once the edit is over', () => {
    const onRename = vi.fn()
    const { result } = renderHook(() => useInlineRename(onRename))

    act(() => result.current.start('Original'))
    attachField(result.current, 'Renamed')
    act(() => result.current.commit())
    onRename.mockClear()

    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    act(() => pointerDownOn(elsewhere))

    expect(onRename).not.toHaveBeenCalled()
  })
})
