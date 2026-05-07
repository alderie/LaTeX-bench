import { useEffect } from 'react'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'

// Global keyboard shortcuts. Mounted once at App level.
//
//   Ctrl/Cmd + B  → manual build
//   Ctrl/Cmd + P  → command palette
//   Ctrl/Cmd + F  → find bar
//   Ctrl/Cmd + \  → symbol palette
//   Ctrl/Cmd + S  → flush save now (in case the user wants a clean state)
//
// CodeMirror-scoped shortcuts (history, search, defaultKeymap) live in
// SourceEditor; we only handle window-level ones here so they fire even
// when focus is in the side panel or palette.

function isModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey
}

export function useShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!isModifier(e)) return

      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        const paperId = usePaperStore.getState().paperId
        if (!paperId) return
        usePaperStore.getState().setBuildState({ state: 'running', errors: [], log: '' })
        void window.latexAPI.build(paperId).catch((err) => {
          usePaperStore.getState().setBuildState({
            state: 'error',
            errors: [{ message: (err as Error).message, severity: 'error' }]
          })
        })
        return
      }

      if (key === 'p') {
        e.preventDefault()
        const ui = useUiStore.getState()
        ui.setPaletteOpen(!ui.paletteOpen)
        return
      }

      if (key === 'f') {
        e.preventDefault()
        const ui = useUiStore.getState()
        ui.setFindBarOpen(!ui.findBarOpen)
        return
      }

      if (key === '\\') {
        e.preventDefault()
        const ui = useUiStore.getState()
        ui.setSymbolPaletteOpen(!ui.symbolPaletteOpen)
        return
      }

      if (key === 's') {
        e.preventDefault()
        void usePaperStore.getState().flushSave()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
