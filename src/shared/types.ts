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

/**
 * A package the compile stopped for, and the file that gave it away.
 *
 * Carried on the build result so the build panel can offer to install it
 * rather than leaving "File `mathtools.sty' not found" as the last word.
 */
export interface MissingPackage {
  /** The file TeX could not find, e.g. `mathtools.sty`. */
  file: string
  /** The TeX Live package that provides it, e.g. `mathtools`. */
  name: string
}

export interface BuildResult {
  success: boolean
  paperId: string
  pdfPath: string | null
  log: string
  errors: BuildError[]
  /** Empty unless the build died for want of a package we can fetch. */
  missingPackages: MissingPackage[]
  durationMs: number
}

// ── Managed TeX installation ─────────────────────────────────────────────
//
// The app can install its own TeX Live into a directory it owns, so a user
// who has never installed TeX can compile a paper without leaving the app —
// and can get rid of all of it again by deleting one folder.

export type TexInstallPhase =
  | 'idle'
  | 'download'
  | 'extract'
  | 'install'
  | 'configure'
  | 'packages'
  | 'done'
  | 'failed'

export interface TexInstallProgress {
  phase: TexInstallPhase
  /** 0–100 across the whole job, not within the phase. */
  percent: number
  /** What is happening right now, in a few words. */
  message: string
  /** Present when `phase` is 'failed'. */
  error?: string
}

export interface TexInstallState {
  /** A usable managed installation is present. */
  installed: boolean
  /** An install is running right now. */
  installing: boolean
  /** Absolute path of the managed directory, whether or not it exists. */
  directory: string
  /** Absolute path of the managed `bin` directory, when installed. */
  binDir: string | null
  /** e.g. "TeX Live 2026". */
  version: string | null
  /** Bytes on disk, or 0 when not installed. */
  sizeBytes: number
  /** The most recent progress record, so a reopened window can catch up. */
  progress: TexInstallProgress
  /** A TeX found on the system PATH, which makes installing optional. */
  systemTexAvailable: boolean
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

/**
 * A known MCP client we can auto-detect on this machine and wire to the editor
 * in one click. Produced by the main-process agent detector, consumed by the
 * connect popover. `installed`/`connected` reflect the state at detection time
 * and are refreshed after every connect/disconnect action.
 */
export interface DetectedAgent {
  /** Stable id, e.g. 'claude-code' | 'claude-desktop' | 'cursor'. */
  id: string
  /** Display name shown in the popover. */
  name: string
  /** One-line hint about how this client reaches the editor. */
  hint: string
  /** The client appears installed (a config file or app dir was found). */
  installed: boolean
  /** Our MCP server is already present in this client's config. */
  connected: boolean
  /** Absolute path to the config file we read/write. */
  configPath: string
  /** We can perform a 1-click connect/disconnect by editing the config file. */
  canAutoConnect: boolean
  /** Copy-paste setup used as a fallback (and for clients we can't auto-edit). */
  manualSnippet: string
}

/** Result of a connect/disconnect action, carrying the refreshed agent record. */
export interface AgentActionResult {
  ok: boolean
  /** Human-readable reason when `ok` is false (e.g. unparseable config). */
  error?: string
  /** The agent's state after the action (re-detected), when available. */
  agent?: DetectedAgent
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
  /** Read a paper-relative `.tex` — the files `\input`/`\include` pull in. */
  readTexFile: (paperId: string, relPath: string) => Promise<string>
  writeTexFile: (paperId: string, relPath: string, tex: string) => Promise<void>
  /** Whether a paper-relative `.tex` exists inside the paper's folder. */
  texFileExists: (paperId: string, relPath: string) => Promise<boolean>
  /** Every `.tex` in the paper folder, paper-relative. */
  listTexFiles: (paperId: string) => Promise<string[]>
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

export interface TexAPI {
  /** Current state of the managed installation. */
  getState: () => Promise<TexInstallState>
  /** Download and install TeX Live into the app's own directory. */
  install: () => Promise<TexInstallState>
  /** Stop an install in progress and clean up the partial tree. */
  cancel: () => Promise<TexInstallState>
  /** Delete the managed installation. */
  remove: () => Promise<TexInstallState>
  /** Add packages to the existing installation, e.g. one a build asked for. */
  installPackages: (names: string[]) => Promise<TexInstallState>
  /** Reveal the managed directory in the OS file manager. */
  reveal: () => Promise<void>
  onProgress: (cb: (progress: TexInstallProgress) => void) => () => void
}

export interface McpAPI {
  start: () => Promise<McpStatusInfo>
  stop: () => Promise<McpStatusInfo>
  getStatus: () => Promise<McpStatusInfo>
  onStatusChanged: (cb: (status: McpStatusInfo) => void) => () => void
  /** Scan the machine for known MCP clients and their current wiring. */
  detectAgents: () => Promise<DetectedAgent[]>
  /** Add our server to a client's own config file. */
  connectAgent: (id: string) => Promise<AgentActionResult>
  /** Remove our server from a client's own config file. */
  disconnectAgent: (id: string) => Promise<AgentActionResult>
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
