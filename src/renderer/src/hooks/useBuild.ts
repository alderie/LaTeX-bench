import { useEffect, useRef } from 'react'
import { usePaperStore } from '../stores/paperStore'

const AUTO_BUILD_DEBOUNCE_MS = 1500

// Wires the renderer's build state to the main-process latexAPI:
//   - listens for streaming progress + complete events
//   - debounces tex changes into auto-build calls
// Mount once at the App level.
export function useBuild(): void {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const offProgress = window.latexAPI.onProgress(({ paperId, line }) => {
      const cur = usePaperStore.getState()
      if (cur.paperId !== paperId) return
      // Append a bounded slice of the log so we don't grow it unbounded
      // for very chatty pdflatex runs.
      const next = (cur.build.log + '\n' + line).slice(-32_000)
      cur.setBuildState({ log: next })
    })

    const offComplete = window.latexAPI.onComplete((result) => {
      const cur = usePaperStore.getState()
      if (cur.paperId !== result.paperId) return
      cur.setBuildState({
        state: result.success ? 'success' : 'error',
        log: result.log,
        pdfPath: result.pdfPath,
        errors: result.errors,
        durationMs: result.durationMs
      })
    })

    return () => {
      offProgress()
      offComplete()
    }
  }, [])

  // Auto-build: subscribe to tex changes (NOT external — those came from a
  // build round-trip) and kick off a debounced build.
  useEffect(() => {
    const unsub = usePaperStore.subscribe((s, prev) => {
      if (!s.paperId) return
      if (s.paperId !== prev.paperId) {
        // New paper just loaded — flush any pending build to avoid building
        // the previous paper after a switch.
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current)
          debounceTimer.current = null
        }
        return
      }
      if (s.applyingExternal) return
      if (s.tex === prev.tex) return
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        const cur = usePaperStore.getState()
        if (!cur.paperId) return
        cur.setBuildState({ state: 'running', errors: [], log: '' })
        void window.latexAPI.build(cur.paperId).catch((err) => {
          cur.setBuildState({
            state: 'error',
            errors: [{ message: (err as Error).message, severity: 'error' }]
          })
        })
      }, AUTO_BUILD_DEBOUNCE_MS)
    })
    return () => {
      unsub()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])
}
