import { useEffect, useRef } from 'react'
import { usePaperStore } from '../stores/paperStore'

const AUTO_BUILD_DEBOUNCE_MS = 1500

/**
 * How often streamed compiler output reaches the store.
 *
 * pdflatex is extremely chatty — a few thousand lines for one pass of an
 * ordinary paper — and each one used to be its own store write: a string
 * concatenation, a 32 KB `slice`, an immer draft, and a React render of the
 * build panel. All of that on the same thread as the editor, while the author
 * carried on typing. Eight flushes a second is still a live tail to look at
 * and roughly two orders of magnitude less work.
 */
const LOG_FLUSH_MS = 120

/** Cap on the retained log, so a runaway build can't grow it without bound. */
const LOG_LIMIT = 32_000

// Wires the renderer's build state to the main-process latexAPI:
//   - listens for streaming progress + complete events
//   - debounces tex changes into auto-build calls
// Mount once at the App level.
export function useBuild(): void {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Lines arriving between flushes. Held in an array rather than
    // concatenated as they come: joining once per flush is one allocation
    // instead of one per line.
    let buffered: string[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      flushTimer = null
      if (buffered.length === 0) return
      const chunk = buffered.join('\n')
      buffered = []
      const cur = usePaperStore.getState()
      cur.setBuildState({ log: (cur.build.log + '\n' + chunk).slice(-LOG_LIMIT) })
    }

    const stopFlushing = (): void => {
      if (flushTimer === null) return
      clearTimeout(flushTimer)
      flushTimer = null
      buffered = []
    }

    const offProgress = window.latexAPI.onProgress(({ paperId, line }) => {
      const cur = usePaperStore.getState()
      if (cur.paperId !== paperId) return
      buffered.push(line)
      if (flushTimer === null) flushTimer = setTimeout(flush, LOG_FLUSH_MS)
    })

    const offComplete = window.latexAPI.onComplete((result) => {
      const cur = usePaperStore.getState()
      if (cur.paperId !== result.paperId) return
      // The result carries the whole log, read from the `.log` file, so
      // anything still buffered is about to be superseded.
      stopFlushing()
      cur.setBuildState({
        state: result.success ? 'success' : 'error',
        log: result.log,
        pdfPath: result.pdfPath,
        errors: result.errors,
        missingPackages: result.missingPackages,
        durationMs: result.durationMs,
        // A rebuild writes the same path, so the path alone can't tell the
        // preview that the bytes behind it changed.
        revision: cur.build.revision + 1
      })
    })

    return () => {
      offProgress()
      offComplete()
      stopFlushing()
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
        cur.setBuildState({ state: 'running', errors: [], missingPackages: [], log: '' })
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
