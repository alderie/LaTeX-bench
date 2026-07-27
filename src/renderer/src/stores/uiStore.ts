import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  applyZoom,
  applyZoomNow,
  DEFAULT_ZOOM,
  nextZoomStop,
  persistZoom,
  quantizeZoom,
  readStoredZoom
} from '../editor/zoom'

export type Theme = 'light' | 'dark' | 'system'
export type ViewMode = 'source' | 'wysiwyg'

interface UiState {
  theme: Theme
  viewMode: ViewMode
  sidebarOpen: boolean
  paletteOpen: boolean
  findBarOpen: boolean
  /** Whether the find widget is showing its replace row. */
  findReplaceOpen: boolean
  /** Bumped every time find is (re-)invoked, so the widget re-seeds itself. */
  findRequest: number
  minimapOpen: boolean
  symbolPaletteOpen: boolean
  /** Paper-view scale. 1 = 100%; the editor reads it as a CSS variable. */
  zoom: number
  setZoom: (zoom: number) => void
  stepZoom: (direction: 1 | -1) => void
  resetZoom: () => void
  setTheme: (theme: Theme) => void
  setViewMode: (mode: ViewMode) => void
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void
  setFindBarOpen: (open: boolean) => void
  /** Open find (optionally with replace showing) and re-seed from selection. */
  openFind: (withReplace?: boolean) => void
  closeFind: () => void
  toggleFindReplace: () => void
  toggleMinimap: () => void
  setSymbolPaletteOpen: (open: boolean) => void
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeAttribute(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

// Apply the persisted value before first paint — otherwise the paper renders
// at 100% and visibly jumps to the user's zoom.
applyZoomNow(readStoredZoom())

export const useUiStore = create<UiState>()(
  immer((set) => ({
    theme: (localStorage.getItem('theme') as Theme | null) ?? 'system',
    viewMode: 'wysiwyg',
    // Bumped key so prior-session 'true' values don't override the new
    // closed-by-default behavior.
    sidebarOpen: localStorage.getItem('sidebarOpen.v2') === 'true',
    paletteOpen: false,
    findBarOpen: false,
    findReplaceOpen: false,
    findRequest: 0,
    // On by default — a minimap you have to discover isn't one.
    minimapOpen: localStorage.getItem('minimap') !== 'false',
    symbolPaletteOpen: false,
    zoom: readStoredZoom(),

    setZoom: (zoom) =>
      set((s) => {
        s.zoom = quantizeZoom(zoom)
        persistZoom(s.zoom)
        applyZoom(s.zoom)
      }),
    stepZoom: (direction) =>
      set((s) => {
        s.zoom = nextZoomStop(s.zoom, direction)
        persistZoom(s.zoom)
        applyZoom(s.zoom)
      }),
    resetZoom: () =>
      set((s) => {
        s.zoom = DEFAULT_ZOOM
        persistZoom(s.zoom)
        applyZoom(s.zoom)
      }),
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
        if (!open) s.findReplaceOpen = false
      }),
    // Ctrl+F on an already-open widget re-seeds it from the selection and
    // re-focuses the field rather than closing it — the same key pressed
    // twice in VS Code never leaves you with the bar gone and your query
    // lost, and the old toggle did exactly that.
    openFind: (withReplace = false) =>
      set((s) => {
        s.findBarOpen = true
        if (withReplace) s.findReplaceOpen = true
        s.findRequest += 1
      }),
    closeFind: () =>
      set((s) => {
        s.findBarOpen = false
        s.findReplaceOpen = false
      }),
    toggleFindReplace: () =>
      set((s) => {
        s.findReplaceOpen = !s.findReplaceOpen
      }),
    toggleMinimap: () =>
      set((s) => {
        s.minimapOpen = !s.minimapOpen
        localStorage.setItem('minimap', String(s.minimapOpen))
      }),
    setSymbolPaletteOpen: (open) =>
      set((s) => {
        s.symbolPaletteOpen = open
      })
  }))
)
