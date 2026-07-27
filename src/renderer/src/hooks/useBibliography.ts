import { useEffect } from 'react'
import { usePaperStore } from '../stores/paperStore'
import { loadBibliography } from '../editor/bibliography'

// Keeps the parsed bibliography in step with the `.bib` the store holds.
//
// The store already read `references` on open and wrote it back on change;
// this is the piece that made it mean something. Mount once at the App level.
export function useBibliography(): void {
  useEffect(() => {
    void loadBibliography(usePaperStore.getState().references)
    return usePaperStore.subscribe((s, prev) => {
      if (s.references === prev.references) return
      void loadBibliography(s.references)
    })
  }, [])
}
