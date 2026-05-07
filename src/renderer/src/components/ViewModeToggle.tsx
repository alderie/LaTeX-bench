import * as React from 'react'
import { useUiStore, type ViewMode } from '../stores/uiStore'

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'wysiwyg', label: 'WYSIWYG' }
]

export function ViewModeToggle(): React.JSX.Element {
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  return (
    <div className="view-mode-toggle" role="tablist">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={viewMode === m.id}
          className={
            'view-mode-toggle__btn' +
            (viewMode === m.id ? ' view-mode-toggle__btn--active' : '')
          }
          onClick={() => setViewMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
