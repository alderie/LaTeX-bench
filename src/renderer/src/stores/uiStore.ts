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
  /** The document outline rail beside the editor. */
  outlineOpen: boolean
  /** The compiled PDF, in a split pane beside the editor. */
  previewOpen: boolean
  /** Preview pane width in pixels. Dragged by the divider, persisted. */
  previewWidth: number
  /** The build log / error list under the editor. */
  buildPanelOpen: boolean
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
  toggleOutline: () => void
  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  setPreviewWidth: (width: number) => void
  toggleBuildPanel: () => void
  setBuildPanelOpen: (open: boolean) => void
}

/** Keeps the preview pane wide enough to read and narrow enough to leave room. */
export const MIN_PREVIEW_WIDTH = 260
export const MAX_PREVIEW_WIDTH = 1200
const DEFAULT_PREVIEW_WIDTH = 460

function readNumber(key: string, fallback: number): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
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
    outlineOpen: localStorage.getItem('outlineOpen') === 'true',
    previewOpen: localStorage.getItem('previewOpen') === 'true',
    previewWidth: readNumber('previewWidth', DEFAULT_PREVIEW_WIDTH),
    buildPanelOpen: localStorage.getItem('buildPanelOpen') === 'true',
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
      }),
    toggleOutline: () =>
      set((s) => {
        s.outlineOpen = !s.outlineOpen
        localStorage.setItem('outlineOpen', String(s.outlineOpen))
      }),
    togglePreview: () =>
      set((s) => {
        s.previewOpen = !s.previewOpen
        localStorage.setItem('previewOpen', String(s.previewOpen))
      }),
    setPreviewOpen: (open) =>
      set((s) => {
        s.previewOpen = open
        localStorage.setItem('previewOpen', String(open))
      }),
    setPreviewWidth: (width) =>
      set((s) => {
        s.previewWidth = Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, Math.round(width)))
        localStorage.setItem('previewWidth', String(s.previewWidth))
      }),
    toggleBuildPanel: () =>
      set((s) => {
        s.buildPanelOpen = !s.buildPanelOpen
        localStorage.setItem('buildPanelOpen', String(s.buildPanelOpen))
      }),
    setBuildPanelOpen: (open) =>
      set((s) => {
        s.buildPanelOpen = open
        localStorage.setItem('buildPanelOpen', String(open))
      })
  }))
)
