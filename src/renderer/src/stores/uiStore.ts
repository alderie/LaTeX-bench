import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type Theme = 'light' | 'dark' | 'system'
export type ViewMode = 'source' | 'wysiwyg'

interface UiState {
  theme: Theme
  viewMode: ViewMode
  sidebarOpen: boolean
  previewOpen: boolean
  previewFullscreen: boolean
  paletteOpen: boolean
  findBarOpen: boolean
  symbolPaletteOpen: boolean
  lockPreviewToCursor: boolean
  setTheme: (theme: Theme) => void
  setViewMode: (mode: ViewMode) => void
  toggleSidebar: () => void
  togglePreview: () => void
  togglePreviewFullscreen: () => void
  setPaletteOpen: (open: boolean) => void
  setFindBarOpen: (open: boolean) => void
  setSymbolPaletteOpen: (open: boolean) => void
  setLockPreviewToCursor: (lock: boolean) => void
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeAttribute(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

export const useUiStore = create<UiState>()(
  immer((set) => ({
    theme: (localStorage.getItem('theme') as Theme | null) ?? 'system',
    viewMode: 'wysiwyg',
    // Bumped key so prior-session 'true' values don't override the new
    // closed-by-default behavior.
    sidebarOpen: localStorage.getItem('sidebarOpen.v2') === 'true',
    previewOpen: localStorage.getItem('previewOpen.v2') === 'true',
    previewFullscreen: false,
    paletteOpen: false,
    findBarOpen: false,
    symbolPaletteOpen: false,
    lockPreviewToCursor: true,

    setTheme: (theme) =>
      set((s) => {
        s.theme = theme
        localStorage.setItem('theme', theme)
        applyThemeAttribute(theme)
      }),
    setViewMode: (mode) =>
      set((s) => {
        s.viewMode = mode
      }),
    toggleSidebar: () =>
      set((s) => {
        s.sidebarOpen = !s.sidebarOpen
        localStorage.setItem('sidebarOpen.v2', String(s.sidebarOpen))
      }),
    togglePreview: () =>
      set((s) => {
        s.previewOpen = !s.previewOpen
        if (!s.previewOpen) s.previewFullscreen = false
        localStorage.setItem('previewOpen.v2', String(s.previewOpen))
      }),
    togglePreviewFullscreen: () =>
      set((s) => {
        s.previewFullscreen = !s.previewFullscreen
        if (s.previewFullscreen) s.previewOpen = true
      }),
    setPaletteOpen: (open) =>
      set((s) => {
        s.paletteOpen = open
      }),
    setFindBarOpen: (open) =>
      set((s) => {
        s.findBarOpen = open
      }),
    setSymbolPaletteOpen: (open) =>
      set((s) => {
        s.symbolPaletteOpen = open
      }),
    setLockPreviewToCursor: (lock) =>
      set((s) => {
        s.lockPreviewToCursor = lock
      })
  }))
)
