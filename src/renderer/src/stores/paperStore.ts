import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { BuildResult, BuildState } from '@shared/types'

interface PaperState {
  paperId: string | null
  tex: string
  references: string
  dirty: boolean
  // True while we're applying an external change (MCP write, file load) so
  // the editor's onChange should not echo back to disk.
  applyingExternal: boolean
  build: {
    state: BuildState
    log: string
    pdfPath: string | null
    errors: BuildResult['errors']
    durationMs: number
  }
  loadPaper: (paperId: string) => Promise<void>
  unload: () => void
  setTex: (tex: string) => void
  setReferences: (bib: string) => void
  applyExternal: (tex: string) => void
  flushSave: () => Promise<void>
  setBuildState: (patch: Partial<PaperState['build']>) => void
}

const SAVE_DEBOUNCE_MS = 500

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSavePaperId: string | null = null
let pendingSaveTex: string | null = null

async function flushPendingSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (pendingSavePaperId && pendingSaveTex !== null) {
    const id = pendingSavePaperId
    const tex = pendingSaveTex
    pendingSavePaperId = null
    pendingSaveTex = null
    try {
      await window.paperAPI.writeTex(id, tex)
    } catch (err) {
      console.error('[paperStore] writeTex failed:', err)
    }
  }
}

function scheduleSave(paperId: string, tex: string, onAfter: () => void): void {
  pendingSavePaperId = paperId
  pendingSaveTex = tex
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    saveTimer = null
    await flushPendingSave()
    onAfter()
  }, SAVE_DEBOUNCE_MS)
}

export const usePaperStore = create<PaperState>()(
  immer((set, get) => ({
    paperId: null,
    tex: '',
    references: '',
    dirty: false,
    applyingExternal: false,
    build: {
      state: 'idle',
      log: '',
      pdfPath: null,
      errors: [],
      durationMs: 0
    },

    loadPaper: async (paperId: string) => {
      // Flush any pending save for the previously-open paper before swapping.
      await flushPendingSave()
      set((s) => {
        s.applyingExternal = true
      })
      try {
        const [tex, references] = await Promise.all([
          window.paperAPI.readTex(paperId),
          window.paperAPI.readBib(paperId)
        ])
        set((s) => {
          s.paperId = paperId
          s.tex = tex
          s.references = references
          s.dirty = false
          s.build = { state: 'idle', log: '', pdfPath: null, errors: [], durationMs: 0 }
        })
      } finally {
        set((s) => {
          s.applyingExternal = false
        })
      }
    },

    unload: () => {
      void flushPendingSave()
      set((s) => {
        s.paperId = null
        s.tex = ''
        s.references = ''
        s.dirty = false
      })
    },

    setTex: (tex: string) => {
      const state = get()
      if (!state.paperId || state.applyingExternal) {
        // Editor still applies the change locally; we just don't auto-save.
        set((s) => {
          s.tex = tex
        })
        return
      }
      set((s) => {
        s.tex = tex
        s.dirty = true
      })
      const id = state.paperId
      scheduleSave(id, tex, () => {
        // Mark clean once the debounced save lands.
        const cur = get()
        if (cur.paperId === id && cur.tex === tex) {
          set((s) => {
            s.dirty = false
          })
        }
      })
    },

    setReferences: (bib: string) => {
      const state = get()
      if (!state.paperId || state.applyingExternal) {
        set((s) => {
          s.references = bib
        })
        return
      }
      set((s) => {
        s.references = bib
      })
      const id = state.paperId
      // Bib changes are infrequent — write through immediately.
      window.paperAPI.writeBib(id, bib).catch((err) => {
        console.error('[paperStore] writeBib failed:', err)
      })
    },

    applyExternal: (tex: string) =>
      set((s) => {
        s.tex = tex
        s.applyingExternal = true
        // Briefly set the flag; the editor's reflection of the new tex
        // will fire setTex which will see applyingExternal=true and skip.
        // Caller should reset it after the editor settles.
        queueMicrotask(() => {
          set((st) => {
            st.applyingExternal = false
          })
        })
      }),

    flushSave: flushPendingSave,

    setBuildState: (patch) =>
      set((s) => {
        Object.assign(s.build, patch)
      })
  }))
)

// Persist on window unload — best-effort flush so we don't lose unsaved
// edits if the user closes mid-edit.
window.addEventListener('beforeunload', () => {
  void flushPendingSave()
})
