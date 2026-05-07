import * as React from 'react'
import { useEffect } from 'react'
import { PanelLeft, Plus } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return 'just now'
  if (diff < hour) return `${Math.floor(diff / min)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`
  return new Date(ts).toLocaleDateString()
}

export function SidePanel(): React.JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const papers = useLibraryStore((s) => s.papers)
  const loaded = useLibraryStore((s) => s.loaded)
  const selectedPaperId = useLibraryStore((s) => s.selectedPaperId)
  const loadLibrary = useLibraryStore((s) => s.loadLibrary)
  const createPaper = useLibraryStore((s) => s.createPaper)
  const selectPaper = useLibraryStore((s) => s.selectPaper)
  const loadPaper = usePaperStore((s) => s.loadPaper)

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    if (selectedPaperId) {
      void loadPaper(selectedPaperId)
    }
  }, [selectedPaperId, loadPaper])

  const handleCreate = async (): Promise<void> => {
    await createPaper('Untitled paper')
  }

  return (
    <aside className={'side-panel' + (sidebarOpen ? ' side-panel--open' : '')}>
      <div className="side-panel-inner">
        <div className="side-panel__header">
          <span className="side-panel__heading">Papers</span>
          <div className="side-panel__header-actions">
            <button
              className="icon-button"
              title="New paper"
              onClick={handleCreate}
              aria-label="New paper"
            >
              <Plus size={18} strokeWidth={1.5} />
            </button>
            <button
              className="icon-button"
              title="Hide sidebar"
              onClick={toggleSidebar}
              aria-label="Hide sidebar"
            >
              <PanelLeft size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div className="side-panel__list">
          {!loaded && <div className="side-panel__empty">Loading…</div>}
          {loaded && papers.length === 0 && (
            <div className="side-panel__empty">No papers yet.</div>
          )}
          {papers.map((paper) => (
            <button
              key={paper.id}
              className={
                'side-panel__item' +
                (paper.id === selectedPaperId ? ' side-panel__item--active' : '')
              }
              onClick={() => selectPaper(paper.id)}
            >
              <span className="side-panel__item-title">{paper.title}</span>
              <span className="side-panel__item-meta">{formatRelative(paper.updatedAt)}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
