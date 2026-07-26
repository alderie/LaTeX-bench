// Cross-process type definitions shared between main, preload, and renderer.

// ── Library / paper meta ─────────────────────────────────────────────────

export interface PaperMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface PaperSettings {
  engine: 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk'
  mainFile: string
}

export interface PaperRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  settings: PaperSettings
}

export interface Library {
  papers: PaperMeta[]
  version: number
}

// ── App settings ─────────────────────────────────────────────────────────

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  preferredEngine: PaperSettings['engine']
  mcpAllowedPaperIds: string[] | null
}

// ── LaTeX build ──────────────────────────────────────────────────────────

export type BuildState = 'idle' | 'queued' | 'running' | 'success' | 'error'

export interface BuildError {
  line?: number
  file?: string
  message: string
  severity: 'error' | 'warning'
}

export interface BuildResult {
  success: boolean
  paperId: string
  pdfPath: string | null
  log: string
  errors: BuildError[]
  durationMs: number
}

export interface EngineInfo {
  id: PaperSettings['engine']
  name: string
  available: boolean
  path: string | null
  version: string | null
}

// ── MCP ─────────────────────────────────────────────────────────────────

export type McpServerState = 'offline' | 'starting' | 'online' | 'error'

export interface McpStatusInfo {
  state: McpServerState
  port: number | null
  url: string | null
  agentCount: number
  error?: string
}

// ── Preload API contracts ───────────────────────────────────────────────

export interface PaperAPI {
  listPapers: () => Promise<PaperMeta[]>
  createPaper: (title: string) => Promise<PaperMeta>
  deletePaper: (paperId: string) => Promise<void>
  renamePaper: (paperId: string, title: string) => Promise<PaperMeta>
  readTex: (paperId: string) => Promise<string>
  writeTex: (paperId: string, tex: string) => Promise<void>
  readBib: (paperId: string) => Promise<string>
  writeBib: (paperId: string, bib: string) => Promise<void>
  getSettings: (paperId: string) => Promise<PaperSettings>
  saveSettings: (paperId: string, settings: PaperSettings) => Promise<void>
  onChanged: (cb: (paperId: string) => void) => () => void
}

export interface LatexAPI {
  detectEngines: () => Promise<EngineInfo[]>
  build: (paperId: string) => Promise<BuildResult>
  cancel: (paperId: string) => Promise<void>
  readPdf: (paperId: string) => Promise<Uint8Array | null>
  onProgress: (cb: (e: { paperId: string; line: string }) => void) => () => void
  onComplete: (cb: (result: BuildResult) => void) => () => void
}

export interface McpAPI {
  start: () => Promise<McpStatusInfo>
  stop: () => Promise<McpStatusInfo>
  getStatus: () => Promise<McpStatusInfo>
  onStatusChanged: (cb: (status: McpStatusInfo) => void) => () => void
}

export interface SettingsAPI {
  load: () => Promise<AppSettings>
  save: (settings: AppSettings) => Promise<void>
}

export interface WindowState {
  maximized: boolean
  fullScreen: boolean
}

export interface WindowAPI {
  /** Keeps the native window background in sync with the resolved theme. */
  setChromeColor: (color: string) => Promise<void>
  minimize: () => Promise<void>
  /** Maximises or restores; resolves to the new maximised state. */
  toggleMaximize: () => Promise<boolean>
  close: () => Promise<void>
  getState: () => Promise<WindowState>
  onStateChanged: (cb: (state: WindowState) => void) => () => void
}
