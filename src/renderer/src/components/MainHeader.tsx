import * as React from 'react'
import { PanelLeft, PanelRight, Maximize2, Minimize2, Check, Loader2 } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { usePaperStore } from '../stores/paperStore'
import { useLibraryStore } from '../stores/libraryStore'
import { ViewModeToggle } from './ViewModeToggle'

export function MainHeader(): React.JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const previewOpen = useUiStore((s) => s.previewOpen)
  const previewFullscreen = useUiStore((s) => s.previewFullscreen)
  const togglePreview = useUiStore((s) => s.togglePreview)
  const toggleFullscreen = useUiStore((s) => s.togglePreviewFullscreen)

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
        <button
          className={'icon-button' + (previewOpen ? ' icon-button--active' : '')}
          title={previewOpen ? 'Hide preview' : 'Show preview'}
          onClick={togglePreview}
          aria-label="Toggle preview"
        >
          <PanelRight size={18} strokeWidth={1.5} />
        </button>
        {previewOpen && (
          <button
            className="icon-button"
            title={previewFullscreen ? 'Restore layout' : 'Fullscreen preview'}
            onClick={toggleFullscreen}
            aria-label="Toggle fullscreen preview"
          >
            {previewFullscreen ? (
              <Minimize2 size={16} strokeWidth={1.5} />
            ) : (
              <Maximize2 size={16} strokeWidth={1.5} />
            )}
          </button>
        )}
      </div>
    </header>
  )
}
