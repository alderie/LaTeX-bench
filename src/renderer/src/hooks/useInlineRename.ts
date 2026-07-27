import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'

// Click-to-rename, shared by the sidebar row and the header title.
//
// The interesting part is closing. `onBlur` is the obvious hook and it is
// not enough here: several things in this app call `preventDefault()` on
// mousedown — the citation link handler, the slash menu rows, the formula
// editor's buttons — precisely so they *don't* steal focus. A click on any
// of them leaves the rename field focused and the caret blinking over a
// document the author has already moved on from.
//
// So closing is driven by a `pointerdown` listener instead: anything that
// isn't the field itself ends the edit, whether or not focus moved. `blur`
// is kept as well, for the case where focus leaves without a pointer at all
// (Tab, or the window losing focus).

export interface InlineRename {
  editing: boolean
  value: string
  /** Open the editor with `initial` as the starting text. */
  start: (initial: string) => void
  /** Accept the current text (no-op if unchanged or empty). */
  commit: () => void
  /** Abandon the edit. */
  cancel: () => void
  setValue: (next: string) => void
  /** Spread onto the `<input>`. */
  inputProps: {
    ref: (el: HTMLInputElement | null) => void
    value: string
    onChange: (event: ChangeEvent<HTMLInputElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
    onBlur: () => void
    spellCheck: false
  }
}

export function useInlineRename(
  onRename: (next: string) => void | Promise<void>
): InlineRename {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const originalRef = useRef('')
  // Commit runs from a pointer listener, a blur, and Enter — all of which
  // can fire for one interaction. Renaming once is the point.
  const closedRef = useRef(true)

  const commit = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    setEditing(false)
    const next = inputRef.current?.value ?? value
    const trimmed = next.trim()
    if (trimmed !== '' && trimmed !== originalRef.current) void onRename(trimmed)
  }, [onRename, value])

  const cancel = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    setEditing(false)
  }, [])

  const setRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
  }, [])

  const start = useCallback((initial: string) => {
    originalRef.current = initial
    closedRef.current = false
    setValue(initial)
    setEditing(true)
  }, [])

  // Focus and select once, when the field appears. Doing this from the ref
  // callback would re-select on every render, which eats the first keystroke
  // of the second character you type.
  useEffect(() => {
    if (!editing) return
    const field = inputRef.current
    field?.focus()
    field?.select()
  }, [editing])

  useEffect(() => {
    if (!editing) return undefined
    const onPointerDown = (event: PointerEvent | MouseEvent): void => {
      const field = inputRef.current
      if (field && event.target instanceof Node && field.contains(event.target)) return
      commit()
    }
    // Capture phase: a handler further down that calls `stopPropagation`
    // shouldn't be able to keep the rename field open behind it.
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [editing, commit])

  return {
    editing,
    value,
    start,
    commit,
    cancel,
    setValue,
    inputProps: {
      ref: setRef,
      value,
      onChange: (event) => setValue(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
        // Keep keystrokes out of the window-level shortcut handler, so
        // Cmd-F doesn't open the find bar over a rename in progress.
        event.stopPropagation()
      },
      onBlur: commit,
      spellCheck: false
    }
  }
}
