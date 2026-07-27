import * as React from 'react'
import { Code2, FileText, type LucideIcon } from 'lucide-react'
import { useUiStore, type ViewMode } from '../stores/uiStore'

// "Source / WYSIWYG" named the implementation, not the thing you get. These
// name the two ways you see the same paper: its LaTeX, or the typeset page.
const MODES: { id: ViewMode; label: string; icon: LucideIcon; title: string }[] = [
  { id: 'source', label: 'LaTeX', icon: Code2, title: 'Edit the LaTeX source' },
  { id: 'wysiwyg', label: 'Document', icon: FileText, title: 'Edit the typeset document' }
]

export function ViewModeToggle(): React.JSX.Element {
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  return (
    <div className="view-mode-toggle" role="tablist">
      {MODES.map((m) => {
        const Icon = m.icon
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={viewMode === m.id}
            title={m.title}
            className={
              'view-mode-toggle__btn' + (viewMode === m.id ? ' view-mode-toggle__btn--active' : '')
            }
            onClick={() => setViewMode(m.id)}
          >
            <Icon size={13} strokeWidth={1.75} aria-hidden />
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
