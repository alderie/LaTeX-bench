import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { FileText, PanelLeft, Plus, Search, Trash2, X } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import { useInlineRename } from '../hooks/useInlineRename'
import {
  FILTER_THRESHOLD,
  filterPapers,
  formatRelative,
  groupPapers
} from '../lib/library-view'
import type { PaperMeta } from '@shared/types'

export function SidePanel(): React.JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const papers = useLibraryStore((s) => s.papers)
  const loaded = useLibraryStore((s) => s.loaded)
  const selectedPaperId = useLibraryStore((s) => s.selectedPaperId)
  const loadLibrary = useLibraryStore((s) => s.loadLibrary)
  const createPaper = useLibraryStore((s) => s.createPaper)
  const selectPaper = useLibraryStore((s) => s.selectPaper)
  const deletePaper = useLibraryStore((s) => s.deletePaper)
  const renamePaper = useLibraryStore((s) => s.renamePaper)
  const loadPaper = usePaperStore((s) => s.loadPaper)

  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const rename = useInlineRename(async (title) => {
    if (renamingId) await renamePaper(renamingId, title)
  })

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    if (selectedPaperId) {
      void loadPaper(selectedPaperId)
    }
  }, [selectedPaperId, loadPaper])

  const groups = useMemo(() => groupPapers(filterPapers(papers, query)), [papers, query])
  const showFilter = papers.length >= FILTER_THRESHOLD

  const handleCreate = async (): Promise<void> => {
    await createPaper('Untitled paper')
  }

  const handleDelete = async (paper: PaperMeta): Promise<void> => {
    const ok = window.confirm(`Delete "${paper.title}"? This cannot be undone.`)
    if (!ok) return
    await deletePaper(paper.id)
  }

  const startRename = (paper: PaperMeta): void => {
    setRenamingId(paper.id)
    rename.start(paper.title)
  }

  return (
    <aside className={'side-panel' + (sidebarOpen ? ' side-panel--open' : '')}>
      <div className="side-panel-inner">
        <div className="side-panel__header">
          <span className="side-panel__heading">
            Papers
            {papers.length > 0 && <span className="side-panel__count">{papers.length}</span>}
          </span>
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

        {showFilter && (
          <div className="side-panel__search">
            <Search size={13} strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter papers"
              aria-label="Filter papers"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
                e.stopPropagation()
              }}
            />
            {query !== '' && (
              <button
                className="side-panel__search-clear"
                onClick={() => setQuery('')}
                aria-label="Clear filter"
                title="Clear filter"
              >
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        )}

        <div className="side-panel__list">
          {!loaded && <div className="side-panel__empty">Loading…</div>}

          {loaded && papers.length === 0 && (
            <div className="side-panel__empty">
              <FileText size={20} strokeWidth={1.25} />
              <p>No papers yet</p>
              <button className="side-panel__empty-action" onClick={handleCreate}>
                Create your first paper
              </button>
            </div>
          )}

          {loaded && papers.length > 0 && groups.length === 0 && (
            <div className="side-panel__empty">
              <p>Nothing matches “{query}”</p>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.label} className="side-panel__group">
              <div className="side-panel__group-heading">{group.label}</div>
              {group.papers.map((paper) => {
                const isActive = paper.id === selectedPaperId
                const isRenaming = rename.editing && renamingId === paper.id
                return (
                  <div
                    key={paper.id}
                    className={
                      'side-panel__item' + (isActive ? ' side-panel__item--active' : '')
                    }
                    role="button"
                    tabIndex={0}
                    title={paper.title}
                    onClick={() => {
                      if (isRenaming) return
                      selectPaper(paper.id)
                    }}
                    onDoubleClick={() => startRename(paper)}
                    onKeyDown={(e) => {
                      if (isRenaming) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectPaper(paper.id)
                      } else if (e.key === 'F2') {
                        e.preventDefault()
                        startRename(paper)
                      }
                    }}
                  >
                    <div className="side-panel__item-row">
                      {isRenaming ? (
                        <input
                          className="side-panel__item-input"
                          {...rename.inputProps}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="side-panel__item-title"
                          onClick={(e) => {
                            // A single click on the name of the paper you're
                            // already in renames it; on any other paper it
                            // has to open it first.
                            if (!isActive) return
                            e.stopPropagation()
                            startRename(paper)
                          }}
                        >
                          {paper.title}
                        </span>
                      )}
                      <button
                        className="side-panel__item-delete"
                        title="Delete paper"
                        aria-label="Delete paper"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(paper)
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                    <span className="side-panel__item-meta">
                      {formatRelative(paper.updatedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
