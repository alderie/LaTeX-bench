import * as React from 'react'
import { PanelLeft, Check, Loader2 } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { usePaperStore } from '../stores/paperStore'
import { useLibraryStore } from '../stores/libraryStore'
import { ViewModeToggle } from './ViewModeToggle'
import { WindowControls } from './WindowControls'

export function MainHeader(): React.JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const paperId = usePaperStore((s) => s.paperId)
  const dirty = usePaperStore((s) => s.dirty)
  const papers = useLibraryStore((s) => s.papers)
  const activePaper = papers.find((p) => p.id === paperId)

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
          <span className="main-header__paper">{activePaper.title}</span>
          <span
            className={
              'save-indicator' + (dirty ? ' save-indicator--dirty' : ' save-indicator--saved')
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
