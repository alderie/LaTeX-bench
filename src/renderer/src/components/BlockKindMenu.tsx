import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Heading1, Heading2, Heading3, Pilcrow, Text, Type } from 'lucide-react'
import { setBlockKind, type BlockKind } from '../editor/wysiwyg/editor-bridge'

// The block-kind control: what the caret is in, and what it could be instead.
//
// It names the LaTeX rather than a generic idea of a heading. "Heading 2" is
// the wrong label in a document that will be compiled — the author is going to
// read `\subsection` in the source, in the log when it breaks, and in the
// journal's style guide — so the menu says `\subsection` and puts the level
// number in the glyph.

interface Choice {
  kind: BlockKind
  label: string
  /** The macro this produces, shown as the row's right-hand note. */
  macro: string
  Icon: typeof Pilcrow
}

const CHOICES: Choice[] = [
  { kind: 'body', label: 'Body text', macro: 'paragraph', Icon: Pilcrow },
  { kind: 1, label: 'Section', macro: '\\section', Icon: Heading1 },
  { kind: 2, label: 'Subsection', macro: '\\subsection', Icon: Heading2 },
  { kind: 3, label: 'Subsubsection', macro: '\\subsubsection', Icon: Heading3 },
  { kind: 4, label: 'Paragraph', macro: '\\paragraph', Icon: Text },
  { kind: 5, label: 'Subparagraph', macro: '\\subparagraph', Icon: Type }
]

export function BlockKindMenu({
  block,
  disabled
}: {
  block: BlockKind
  disabled: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Any click that isn't on this control closes it — including one that lands
  // in the document, which is also how the author dismisses it by carrying on
  // typing.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = CHOICES.find((choice) => choice.kind === block)
  const label = current?.label ?? 'Block'

  const choose = (kind: BlockKind): void => {
    setOpen(false)
    setBlockKind(kind)
  }

  return (
    <div className="block-kind" ref={rootRef}>
      <button
        type="button"
        className={`block-kind__button${open ? ' block-kind__button--open' : ''}`}
        title="Block kind  (section, subsection, body text)"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || !current}
        // The editor must keep its selection: a plain click would blur it
        // first, so the command would apply to nothing.
        onMouseDown={(event) => {
          event.preventDefault()
          if (!disabled && current) setOpen((was) => !was)
        }}
      >
        {current ? <current.Icon size={13} /> : null}
        <span className="block-kind__value">{label}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="block-kind__menu" role="listbox">
          {CHOICES.map(({ kind, label: text, macro, Icon }) => (
            <div
              key={String(kind)}
              role="option"
              aria-selected={kind === block}
              className={`block-kind__option${kind === block ? ' block-kind__option--selected' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(kind)
              }}
            >
              <Icon size={14} />
              <span className="block-kind__label">{text}</span>
              <span className="block-kind__macro">{macro}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
