import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { PaperMeta } from '@shared/types'

interface LibraryState {
  papers: PaperMeta[]
  selectedPaperId: string | null
  loading: boolean
  loaded: boolean
  loadLibrary: () => Promise<void>
  createPaper: (title?: string) => Promise<PaperMeta>
  deletePaper: (paperId: string) => Promise<void>
  renamePaper: (paperId: string, title: string) => Promise<void>
  selectPaper: (paperId: string | null) => void
  refresh: () => Promise<void>
}

function sortPapers(papers: PaperMeta[]): PaperMeta[] {
  return [...papers].sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useLibraryStore = create<LibraryState>()(
  immer((set, get) => ({
    papers: [],
    selectedPaperId: null,
    loading: false,
    loaded: false,

    loadLibrary: async () => {
      if (get().loading) return
      set((s) => {
        s.loading = true
      })
      try {
        const papers = await window.paperAPI.listPapers()
        set((s) => {
          s.papers = sortPapers(papers)
          s.loaded = true
          // If nothing's selected, pick the most recent paper.
          if (!s.selectedPaperId && s.papers.length > 0) {
            s.selectedPaperId = s.papers[0].id
          }
        })
      } finally {
        set((s) => {
          s.loading = false
        })
      }
    },

    createPaper: async (title) => {
      const meta = await window.paperAPI.createPaper(title ?? 'Untitled paper')
      set((s) => {
        s.papers = sortPapers([meta, ...s.papers.filter((p) => p.id !== meta.id)])
        s.selectedPaperId = meta.id
      })
      return meta
    },

    deletePaper: async (paperId) => {
      await window.paperAPI.deletePaper(paperId)
      set((s) => {
        s.papers = s.papers.filter((p) => p.id !== paperId)
        if (s.selectedPaperId === paperId) {
          s.selectedPaperId = s.papers[0]?.id ?? null
        }
      })
    },

    renamePaper: async (paperId, title) => {
      const updated = await window.paperAPI.renamePaper(paperId, title)
      set((s) => {
        const idx = s.papers.findIndex((p) => p.id === paperId)
        if (idx >= 0) s.papers[idx] = updated
        s.papers = sortPapers(s.papers)
      })
    },

    selectPaper: (paperId) =>
      set((s) => {
        s.selectedPaperId = paperId
      }),

    refresh: async () => {
      const papers = await window.paperAPI.listPapers()
      set((s) => {
        s.papers = sortPapers(papers)
      })
    }
  }))
)
