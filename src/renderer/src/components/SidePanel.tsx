import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { PanelLeft, Plus, Trash2 } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import type { PaperMeta } from '@shared/types'

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
  const deletePaper = useLibraryStore((s) => s.deletePaper)
  const renamePaper = useLibraryStore((s) => s.renamePaper)
  const loadPaper = usePaperStore((s) => s.loadPaper)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const committingRef = useRef(false)

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

  const startEdit = (paper: PaperMeta): void => {
    setEditingId(paper.id)
    setEditValue(paper.title)
  }

  const commitEdit = async (): Promise<void> => {
    if (committingRef.current) return
    committingRef.current = true
    try {
      const id = editingId
      if (!id) return
      const trimmed = editValue.trim()
      const original = papers.find((p) => p.id === id)
      setEditingId(null)
      if (trimmed && original && trimmed !== original.title) {
        await renamePaper(id, trimmed)
      }
    } finally {
      committingRef.current = false
    }
  }

  const cancelEdit = (): void => {
    setEditingId(null)
  }

  const handleDelete = async (paper: PaperMeta): Promise<void> => {
    const ok = window.confirm(`Delete "${paper.title}"? This cannot be undone.`)
    if (!ok) return
    await deletePaper(paper.id)
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
          {papers.map((paper) => {
            const isActive = paper.id === selectedPaperId
            const isEditing = editingId === paper.id
            return (
              <div
                key={paper.id}
                className={
                  'side-panel__item' + (isActive ? ' side-panel__item--active' : '')
                }
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isEditing) return
                  selectPaper(paper.id)
                }}
                onKeyDown={(e) => {
                  if (isEditing) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectPaper(paper.id)
                  }
                }}
              >
                <div className="side-panel__item-row">
                  {isEditing ? (
                    <input
                      autoFocus
                      className="side-panel__item-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => void commitEdit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitEdit()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="side-panel__item-title"
                      onClick={(e) => {
                        if (isActive) {
                          e.stopPropagation()
                          startEdit(paper)
                        }
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
                <span className="side-panel__item-meta">{formatRelative(paper.updatedAt)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
