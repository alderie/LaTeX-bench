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
  setSymbolPaletteOpen: (open: boolean) => void
}

// Discrete stops rather than a continuous multiplier: the paper is set in a
// serif face at a fixed measure, and arbitrary fractional scales make the
// text render at fuzzy sub-pixel sizes. These match the ratios a browser's
// own zoom uses.
const ZOOM_STOPS = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const DEFAULT_ZOOM = 1

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_STOPS[ZOOM_STOPS.length - 1], Math.max(ZOOM_STOPS[0], zoom))
}

function nextZoomStop(current: number, direction: 1 | -1): number {
  // Nearest stop in the requested direction, so a persisted odd value still
  // steps somewhere sensible.
  const stops = direction === 1 ? ZOOM_STOPS : [...ZOOM_STOPS].reverse()
  const found = stops.find((stop) =>
    direction === 1 ? stop > current + 0.001 : stop < current - 0.001
  )
  return found ?? clampZoom(current)
}

function applyZoom(zoom: number): void {
  document.documentElement.style.setProperty('--paper-zoom', String(zoom))
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeAttribute(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

// Apply the persisted value immediately, before first paint — otherwise the
// paper renders at 100% and visibly jumps to the user's zoom.
applyZoom(clampZoom(Number(localStorage.getItem('paperZoom')) || DEFAULT_ZOOM))

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
    zoom: clampZoom(Number(localStorage.getItem('paperZoom')) || DEFAULT_ZOOM),

    setZoom: (zoom) =>
      set((s) => {
        s.zoom = clampZoom(zoom)
        localStorage.setItem('paperZoom', String(s.zoom))
        applyZoom(s.zoom)
      }),
    stepZoom: (direction) =>
      set((s) => {
        s.zoom = nextZoomStop(s.zoom, direction)
        localStorage.setItem('paperZoom', String(s.zoom))
        applyZoom(s.zoom)
      }),
    resetZoom: () =>
      set((s) => {
        s.zoom = DEFAULT_ZOOM
        localStorage.setItem('paperZoom', String(s.zoom))
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
      }),
    setSymbolPaletteOpen: (open) =>
      set((s) => {
        s.symbolPaletteOpen = open
      })
  }))
)
