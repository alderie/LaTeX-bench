import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'

// Lightweight Find bar — uses the browser's native window.find() against
// the focused editor surface. Both CodeMirror's contenteditable and the
// ProseMirror DOM are real text in the document, so window.find() picks
// them up. Not as feature-rich as @codemirror/search, but works across
// both editor modes uniformly.

export function FindBar(): React.JSX.Element | null {
  const open = useUiStore((s) => s.findBarOpen)
  const setOpen = useUiStore((s) => s.setFindBarOpen)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const close = (): void => setOpen(false)

  const findNext = (backwards: boolean): void => {
    if (!query) return
    // window.find is non-standard but supported in Chromium (Electron).
    ;(window as any).find?.(query, caseSensitive, backwards, true, false, true, false)
  }

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find…"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            findNext(e.shiftKey)
          }
        }}
        className="find-bar__input"
      />
      <button
        className={'find-bar__toggle' + (caseSensitive ? ' find-bar__toggle--active' : '')}
        title="Match case"
        onClick={() => setCaseSensitive((v) => !v)}
      >
        Aa
      </button>
      <button className="find-bar__nav" onClick={() => findNext(true)} title="Previous (Shift+Enter)">
        ↑
      </button>
      <button className="find-bar__nav" onClick={() => findNext(false)} title="Next (Enter)">
        ↓
      </button>
      <button className="icon-button" onClick={close} title="Close (Esc)">
        <X size={14} />
      </button>
    </div>
  )
}
