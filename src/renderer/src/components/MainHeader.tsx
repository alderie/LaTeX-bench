import * as React from 'react'
import { useEffect, useState } from 'react'
import { PanelLeft, Check, Loader2 } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { usePaperStore } from '../stores/paperStore'
import { useLibraryStore } from '../stores/libraryStore'
import { ViewModeToggle } from './ViewModeToggle'
import { WindowControls } from './WindowControls'
import { useInlineRename } from '../hooks/useInlineRename'

export function MainHeader(): React.JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const paperId = usePaperStore((s) => s.paperId)
  const dirty = usePaperStore((s) => s.dirty)
  const papers = useLibraryStore((s) => s.papers)
  const renamePaper = useLibraryStore((s) => s.renamePaper)
  const activePaper = papers.find((p) => p.id === paperId)

  // The title in the header is the most obvious thing in the window to click
  // when you want to rename the paper, so it is now the thing that does it.
  const rename = useInlineRename(async (title) => {
    if (paperId) await renamePaper(paperId, title)
  })

  // "Saved" is worth a beat of attention and then nothing at all — the chip
  // confirms the write, then recedes to a hairline of text so it stops
  // competing with the title. Any new edit brings it back to full weight.
  const [settled, setSettled] = useState(true)
  useEffect(() => {
    if (dirty) {
      setSettled(false)
      return undefined
    }
    const t = setTimeout(() => setSettled(true), 1600)
    return () => clearTimeout(t)
  }, [dirty])

  return (
    <header className="main-header">
      <button
        className={'icon-button' + (sidebarOpen ? ' icon-button--hidden' : '')}
        title="Show sidebar"
        onClick={toggleSidebar}
        aria-label="Show sidebar"
      >
        <PanelLeft size={18} strokeWidth={1.5} />
      </button>

      {activePaper && (
        <>
          {rename.editing ? (
            <input className="main-header__paper-input" {...rename.inputProps} />
          ) : (
            <span
              className="main-header__paper"
              title="Click to rename"
              role="button"
              tabIndex={0}
              onClick={() => rename.start(activePaper.title)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'F2') rename.start(activePaper.title)
              }}
            >
              {activePaper.title}
            </span>
          )}
          <span
            className={
              'save-indicator' +
              (dirty ? ' save-indicator--dirty' : ' save-indicator--saved') +
              (!dirty && settled ? ' save-indicator--settled' : '')
            }
            title={dirty ? 'Saving changes…' : 'All changes saved'}
            aria-live="polite"
          >
            {dirty ? (
              <Loader2 size={12} strokeWidth={2} className="save-indicator__spin" />
            ) : (
              <Check size={12} strokeWidth={2.25} />
            )}
            {dirty ? 'saving' : 'saved'}
          </span>
        </>
      )}

      <div className="main-header__spacer" />

      <div className="main-header__actions">
        {paperId && <ViewModeToggle />}
        <WindowControls />
      </div>
    </header>
  )
}
