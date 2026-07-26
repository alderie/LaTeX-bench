import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type Theme = 'light' | 'dark' | 'system'
export type ViewMode = 'source' | 'wysiwyg'

interface UiState {
  theme: Theme
  viewMode: ViewMode
  sidebarOpen: boolean
  paletteOpen: boolean
  findBarOpen: boolean
  symbolPaletteOpen: boolean
  setTheme: (theme: Theme) => void
  setViewMode: (mode: ViewMode) => void
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void
  setFindBarOpen: (open: boolean) => void
  setSymbolPaletteOpen: (open: boolean) => void
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
    paletteOpen: false,
    findBarOpen: false,
    symbolPaletteOpen: false,

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
      })
  }))
)
