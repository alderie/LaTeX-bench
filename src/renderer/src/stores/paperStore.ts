import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { BuildResult, BuildState } from '@shared/types'
import { extractIncludes } from '../editor/includes'

/** One `.tex` in the paper, as the file switcher and outline see it. */
export interface PaperFile {
  /** Paper-relative path, e.g. `sections/method.tex`. */
  path: string
  /** The file whose `\input` named it; null for the main file. */
  includedBy: string | null
  /** Nesting depth, for indenting the list. */
  depth: number
  /** The macro names a file that isn't on disk. */
  missing: boolean
}

interface PaperState {
  paperId: string | null
  /** The file the compiler is pointed at, from the paper's settings. */
  mainFile: string
  /** The file the editor is showing. `tex` is *this* file's contents. */
  activeFile: string
  /** The main file and everything it reaches through `\input`/`\include`. */
  files: PaperFile[]
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
    /** Packages the build died for want of, which the panel offers to fetch. */
    missingPackages: BuildResult['missingPackages']
    durationMs: number
    /** Bumped on every completed build, so the PDF pane knows to re-read. */
    revision: number
  }
  loadPaper: (paperId: string) => Promise<void>
  unload: () => void
  setTex: (tex: string) => void
  /**
   * Save `tex` as the contents of `file`, whichever file is showing now.
   *
   * The rich editor serializes on a trailing delay, so its last write can
   * land after the user has already opened a different file. Naming the
   * file the content came from is what keeps that write from landing on
   * the wrong one.
   */
  setTexForFile: (file: string, tex: string) => void
  setReferences: (bib: string) => void
  applyExternal: (tex: string) => void
  /** Show a different `.tex` from the same paper. */
  openFile: (path: string) => Promise<void>
  /** Re-walk the `\input` graph from the main file. */
  refreshFiles: () => Promise<void>
  flushSave: () => Promise<void>
  setBuildState: (patch: Partial<PaperState['build']>) => void
}

const SAVE_DEBOUNCE_MS = 500

/** Bound on the `\input` walk, so a pathological paper can't hang the load. */
const MAX_FILES = 200

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSavePaperId: string | null = null
let pendingSaveFile: string | null = null
let pendingSaveTex: string | null = null

async function flushPendingSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (pendingSavePaperId && pendingSaveFile && pendingSaveTex !== null) {
    const id = pendingSavePaperId
    const file = pendingSaveFile
    const tex = pendingSaveTex
    pendingSavePaperId = null
    pendingSaveFile = null
    pendingSaveTex = null
    try {
      await window.paperAPI.writeTexFile(id, file, tex)
    } catch (err) {
      console.error('[paperStore] writeTexFile failed:', err)
    }
  }
}

function scheduleSave(paperId: string, file: string, tex: string, onAfter: () => void): void {
  // A pending write for a *different* file must land before we start
  // tracking this one, or switching files mid-debounce drops the edit.
  if (pendingSavePaperId && (pendingSavePaperId !== paperId || pendingSaveFile !== file)) {
    void flushPendingSave()
  }
  pendingSavePaperId = paperId
  pendingSaveFile = file
  pendingSaveTex = tex
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    saveTimer = null
    await flushPendingSave()
    onAfter()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * Walk the `\input`/`\include` graph breadth-first from the main file.
 *
 * Breadth-first so the list reads in the order the paper is assembled, and
 * cycle-guarded because `\input`ing a file that inputs you back is a mistake
 * a person makes and TeX itself only catches by running out of memory.
 */
async function walkIncludes(
  paperId: string,
  mainFile: string,
  seedText: string | null
): Promise<PaperFile[]> {
  const out: PaperFile[] = [{ path: mainFile, includedBy: null, depth: 0, missing: false }]
  const seen = new Set([mainFile])
  const queue: PaperFile[] = [out[0]]

  while (queue.length > 0 && out.length < MAX_FILES) {
    const current = queue.shift()!
    if (current.missing) continue
    let text: string
    if (current.path === mainFile && seedText !== null) {
      text = seedText
    } else {
      try {
        text = await window.paperAPI.readTexFile(paperId, current.path)
      } catch {
        continue
      }
    }

    for (const ref of extractIncludes(text)) {
      if (seen.has(ref.path)) continue
      seen.add(ref.path)
      let missing = false
      try {
        missing = !(await window.paperAPI.texFileExists(paperId, ref.path))
      } catch {
        missing = true
      }
      const child: PaperFile = {
        path: ref.path,
        includedBy: current.path,
        depth: current.depth + 1,
        missing
      }
      out.push(child)
      queue.push(child)
      if (out.length >= MAX_FILES) break
    }
  }
  return out
}

/** What a file pulls in, as one comparable string. */
function includeSignature(tex: string): string {
  return extractIncludes(tex)
    .map((ref) => ref.path)
    .join(' ')
}

const includeSignatures = new Map<string, string>()

const EMPTY_BUILD = (): PaperState['build'] => ({
  state: 'idle',
  log: '',
  pdfPath: null,
  errors: [],
  missingPackages: [],
  durationMs: 0,
  revision: 0
})

export const usePaperStore = create<PaperState>()(
  immer((set, get) => ({
    paperId: null,
    mainFile: 'main.tex',
    activeFile: 'main.tex',
    files: [],
    tex: '',
    references: '',
    dirty: false,
    applyingExternal: false,
    build: EMPTY_BUILD(),

    loadPaper: async (paperId: string) => {
      // Flush any pending save for the previously-open paper before swapping.
      await flushPendingSave()
      set((s) => {
        s.applyingExternal = true
      })
      try {
        const [tex, references, settings] = await Promise.all([
          window.paperAPI.readTex(paperId),
          window.paperAPI.readBib(paperId),
          window.paperAPI.getSettings(paperId).catch(() => ({ mainFile: 'main.tex' }))
        ])
        const mainFile = settings.mainFile || 'main.tex'
        set((s) => {
          s.paperId = paperId
          s.mainFile = mainFile
          s.activeFile = mainFile
          s.files = [{ path: mainFile, includedBy: null, depth: 0, missing: false }]
          s.tex = tex
          s.references = references
          s.dirty = false
          s.build = EMPTY_BUILD()
        })
      } finally {
        set((s) => {
          s.applyingExternal = false
        })
      }
      // The `\input` walk is I/O against files we don't need to show the
      // main document, so it lands after the editor already has something.
      await get().refreshFiles()
    },

    unload: () => {
      void flushPendingSave()
      set((s) => {
        s.paperId = null
        s.tex = ''
        s.references = ''
        s.files = []
        s.activeFile = s.mainFile
        s.dirty = false
      })
    },

    openFile: async (path: string) => {
      const state = get()
      if (!state.paperId || path === state.activeFile) return
      await flushPendingSave()
      const paperId = state.paperId
      let text = ''
      try {
        text =
          path === state.mainFile
            ? await window.paperAPI.readTex(paperId)
            : await window.paperAPI.readTexFile(paperId, path)
      } catch (err) {
        console.error('[paperStore] readTexFile failed:', err)
        return
      }
      if (get().paperId !== paperId) return
      set((s) => {
        s.activeFile = path
        s.tex = text
        s.dirty = false
        s.applyingExternal = true
      })
      // Let the editors swallow the swap without echoing it back to disk.
      queueMicrotask(() => {
        set((s) => {
          s.applyingExternal = false
        })
      })
    },

    refreshFiles: async () => {
      const { paperId, mainFile, activeFile, tex } = get()
      if (!paperId) return
      const files = await walkIncludes(paperId, mainFile, activeFile === mainFile ? tex : null)
      if (get().paperId !== paperId) return
      set((s) => {
        s.files = files
      })
    },

    setTexForFile: (file: string, tex: string) => {
      const state = get()
      if (!state.paperId) return
      if (file === state.activeFile) {
        get().setTex(tex)
        return
      }
      // The editor finished a deferred serialize *after* the user switched
      // files. Routing it through `setTex` would file the old document's
      // contents under the new document's name and overwrite it — so the
      // late write goes straight to the file it actually belongs to, and
      // the visible document is left alone.
      window.paperAPI.writeTexFile(state.paperId, file, tex).catch((err) => {
        console.error('[paperStore] late writeTexFile failed:', err)
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
      const file = state.activeFile
      scheduleSave(id, file, tex, () => {
        // Mark clean once the debounced save lands.
        const cur = get()
        if (cur.paperId === id && cur.activeFile === file && cur.tex === tex) {
          set((s) => {
            s.dirty = false
          })
        }
        // Re-walk only when this edit changed which files are pulled in.
        // Typing prose touches no `\input`, and re-reading every section
        // file twice a second because a word changed is pure waste.
        const signature = includeSignature(tex)
        if (includeSignatures.get(`${id} ${file}`) !== signature) {
          includeSignatures.set(`${id} ${file}`, signature)
          void get().refreshFiles()
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
