import { readFile, writeFile, rename, mkdir, readdir, rm, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join, normalize, sep } from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type {
  AppSettings,
  Library,
  PaperMeta,
  PaperRecord,
  PaperSettings
} from '../shared/types'

// electron-store v10+ is ESM-only; load it via dynamic import().
let _settingsStore: any = null
let _initPromise: Promise<void> | null = null

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  preferredEngine: 'latexmk',
  mcpAllowedPaperIds: null
}

export function initStores(): Promise<void> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const { default: Store } = await import('electron-store')
    _settingsStore = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_APP_SETTINGS
    })
  })()
  return _initPromise
}

export function whenStoresReady(): Promise<void> {
  return _initPromise ?? initStores()
}

export function getSettingsStore() {
  if (!_settingsStore) throw new Error('Stores not initialized — call initStores() first')
  return _settingsStore as import('electron-store').default<AppSettings>
}

// ── Paper store layout on disk ───────────────────────────────────────────
//
// {userData}/synthetic-corbato/
//   library.json                       — index of all papers
//   papers/
//     <paperId>/
//       paper.json                     — title, settings, timestamps
//       main.tex
//       references.bib
//       assets/
//       out/main.pdf
//       .build/                        — pdflatex aux files (gitignored)

const ROOT_DIR_NAME = 'synthetic-corbato'
const LIBRARY_FILE = 'library.json'
const PAPER_RECORD = 'paper.json'
const MAIN_TEX = 'main.tex'
const REFS_BIB = 'references.bib'
const OUT_DIR = 'out'
const BUILD_DIR = '.build'
const ASSETS_DIR = 'assets'
const PDF_NAME = 'main.pdf'

const DEFAULT_PAPER_SETTINGS: PaperSettings = { engine: 'latexmk', mainFile: MAIN_TEX }

const STARTER_TEX = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Untitled paper}
\\author{ }
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Welcome to your new paper. Replace this section with your own content.

The fine-structure constant satisfies $\\alpha \\approx 1/137$.

\\begin{equation}
  E = mc^2.
\\end{equation}

\\end{document}
`

export class PaperStoreManager {
  readonly rootDir: string
  private writeLock: Promise<void> = Promise.resolve()

  constructor(
    userDataDir: string,
    private mainWindow: BrowserWindow
  ) {
    this.rootDir = join(userDataDir, ROOT_DIR_NAME)
  }

  // ── Library ──

  private libraryPath(): string {
    return join(this.rootDir, LIBRARY_FILE)
  }

  private async ensureRoot(): Promise<void> {
    if (!existsSync(this.rootDir)) await mkdir(this.rootDir, { recursive: true })
    if (!existsSync(join(this.rootDir, 'papers')))
      await mkdir(join(this.rootDir, 'papers'), { recursive: true })
  }

  private async readLibrary(): Promise<Library> {
    await this.ensureRoot()
    const path = this.libraryPath()
    if (!existsSync(path)) return { papers: [], version: 1 }
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as Library
    } catch (err) {
      console.error('[Store] library read failed:', err)
      return { papers: [], version: 1 }
    }
  }

  private async writeLibrary(library: Library): Promise<void> {
    const path = this.libraryPath()
    const tmp = path + '.tmp'
    await writeFile(tmp, JSON.stringify(library, null, 2), 'utf-8')
    await rename(tmp, path)
  }

  async listPapers(): Promise<PaperMeta[]> {
    const library = await this.readLibrary()
    return [...library.papers].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ── Paper folder helpers ──

  paperDir(paperId: string): string {
    return join(this.rootDir, 'papers', paperId)
  }

  paperFile(paperId: string, ...rel: string[]): string {
    return join(this.paperDir(paperId), ...rel)
  }

  private async ensurePaperDir(paperId: string): Promise<void> {
    const dir = this.paperDir(paperId)
    await mkdir(dir, { recursive: true })
    await mkdir(join(dir, ASSETS_DIR), { recursive: true })
    await mkdir(join(dir, OUT_DIR), { recursive: true })
    await mkdir(join(dir, BUILD_DIR), { recursive: true })
  }

  private async readRecord(paperId: string): Promise<PaperRecord | null> {
    const path = this.paperFile(paperId, PAPER_RECORD)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as PaperRecord
    } catch {
      return null
    }
  }

  private async writeRecord(record: PaperRecord): Promise<void> {
    const path = this.paperFile(record.id, PAPER_RECORD)
    const tmp = path + '.tmp'
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf-8')
    await rename(tmp, path)
  }

  // ── Mutations ──

  async createPaper(title: string): Promise<PaperMeta> {
    const id = randomUUID()
    const now = Date.now()
    const record: PaperRecord = {
      id,
      title: title.trim() || 'Untitled paper',
      createdAt: now,
      updatedAt: now,
      settings: { ...DEFAULT_PAPER_SETTINGS }
    }
    await this.ensurePaperDir(id)
    await this.writeRecord(record)
    await writeFile(this.paperFile(id, MAIN_TEX), STARTER_TEX, 'utf-8')
    await writeFile(this.paperFile(id, REFS_BIB), '', 'utf-8')

    const library = await this.readLibrary()
    library.papers.push({
      id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    })
    await this.writeLibrary(library)

    return { id, title: record.title, createdAt: now, updatedAt: now }
  }

  async deletePaper(paperId: string): Promise<void> {
    const dir = this.paperDir(paperId)
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true })

    const library = await this.readLibrary()
    library.papers = library.papers.filter((p) => p.id !== paperId)
    await this.writeLibrary(library)
  }

  async renamePaper(paperId: string, title: string): Promise<PaperMeta> {
    const record = await this.readRecord(paperId)
    if (!record) throw new Error(`Paper ${paperId} not found`)
    record.title = title.trim() || record.title
    record.updatedAt = Date.now()
    await this.writeRecord(record)

    const library = await this.readLibrary()
    const meta = library.papers.find((p) => p.id === paperId)
    if (meta) {
      meta.title = record.title
      meta.updatedAt = record.updatedAt
      await this.writeLibrary(library)
    }
    return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt }
  }

  // ── Tex / bib I/O (write-locked, atomic, notifies renderer on external writes) ──

  async readTex(paperId: string): Promise<string> {
    const path = this.paperFile(paperId, MAIN_TEX)
    if (!existsSync(path)) return ''
    return readFile(path, 'utf-8')
  }

  /** Writes from the renderer's own save loop. Does NOT broadcast paper:changed. */
  async writeTex(paperId: string, tex: string): Promise<void> {
    await this.queueWrite(async () => {
      await this.ensurePaperDir(paperId)
      const path = this.paperFile(paperId, MAIN_TEX)
      const tmp = path + '.tmp'
      await writeFile(tmp, tex, 'utf-8')
      await rename(tmp, path)
      await this.bumpUpdatedAt(paperId)
    })
  }

  /** Writes from MCP / external sources — broadcasts paper:changed. */
  async writeTexExternal(paperId: string, tex: string): Promise<void> {
    await this.writeTex(paperId, tex)
    this.broadcastChanged(paperId)
  }

  async readBib(paperId: string): Promise<string> {
    const path = this.paperFile(paperId, REFS_BIB)
    if (!existsSync(path)) return ''
    return readFile(path, 'utf-8')
  }

  async writeBib(paperId: string, bib: string): Promise<void> {
    await this.queueWrite(async () => {
      await this.ensurePaperDir(paperId)
      const path = this.paperFile(paperId, REFS_BIB)
      const tmp = path + '.tmp'
      await writeFile(tmp, bib, 'utf-8')
      await rename(tmp, path)
      await this.bumpUpdatedAt(paperId)
    })
  }

  async getSettings(paperId: string): Promise<PaperSettings> {
    const record = await this.readRecord(paperId)
    return record?.settings ?? { ...DEFAULT_PAPER_SETTINGS }
  }

  async saveSettings(paperId: string, settings: PaperSettings): Promise<void> {
    const record = await this.readRecord(paperId)
    if (!record) throw new Error(`Paper ${paperId} not found`)
    record.settings = settings
    record.updatedAt = Date.now()
    await this.writeRecord(record)
  }

  // ── Multi-file: the `.tex` files a paper `\input`s ──
  //
  // The renderer resolves `\input{sections/method}` into a path and asks for
  // it by name. Everything below is sandboxed to the paper's own folder and
  // to `.tex` files, so a crafted `\input{../../../etc/passwd}` in a shared
  // paper resolves outside the sandbox and is refused rather than served.

  /** Absolute path for a paper-relative `.tex`, or null if it escapes. */
  private resolveTexPath(paperId: string, relPath: string): string | null {
    if (!relPath || !relPath.toLowerCase().endsWith('.tex')) return null
    const paperDir = this.paperDir(paperId)
    const target = normalize(join(paperDir, relPath))
    if (!target.startsWith(paperDir + sep)) return null
    // The build and output folders are generated; they are not the source.
    const rel = target.slice(paperDir.length + 1)
    if (rel.startsWith(BUILD_DIR + sep) || rel.startsWith(OUT_DIR + sep)) return null
    return target
  }

  async readTexFile(paperId: string, relPath: string): Promise<string> {
    const path = this.resolveTexPath(paperId, relPath)
    if (!path || !existsSync(path)) return ''
    return readFile(path, 'utf-8')
  }

  async writeTexFile(paperId: string, relPath: string, tex: string): Promise<void> {
    const path = this.resolveTexPath(paperId, relPath)
    if (!path) throw new Error(`Refusing to write outside the paper folder: ${relPath}`)
    await this.queueWrite(async () => {
      await mkdir(dirname(path), { recursive: true })
      const tmp = path + '.tmp'
      await writeFile(tmp, tex, 'utf-8')
      await rename(tmp, path)
      await this.bumpUpdatedAt(paperId)
    })
  }

  /** Whether a paper-relative `.tex` exists and is inside the sandbox. */
  async texFileExists(paperId: string, relPath: string): Promise<boolean> {
    const path = this.resolveTexPath(paperId, relPath)
    return path !== null && existsSync(path)
  }

  /** Every `.tex` in the paper folder, paper-relative, in sorted order. */
  async listTexFiles(paperId: string): Promise<string[]> {
    const paperDir = this.paperDir(paperId)
    if (!existsSync(paperDir)) return []
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        const rel = full.slice(paperDir.length + 1)
        if (entry.isDirectory()) {
          if (entry.name === BUILD_DIR || entry.name === OUT_DIR || entry.name.startsWith('.')) {
            continue
          }
          await walk(full)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) {
          out.push(rel.split(sep).join('/'))
        }
      }
    }
    await walk(paperDir)
    return out.sort()
  }

  async readPdf(paperId: string): Promise<Uint8Array | null> {
    const path = this.paperFile(paperId, OUT_DIR, PDF_NAME)
    if (!existsSync(path)) return null
    const buf = await readFile(path)
    return new Uint8Array(buf)
  }

  // ── Internal helpers ──

  private async bumpUpdatedAt(paperId: string): Promise<void> {
    const record = await this.readRecord(paperId)
    if (!record) return
    record.updatedAt = Date.now()
    await this.writeRecord(record)
    const library = await this.readLibrary()
    const meta = library.papers.find((p) => p.id === paperId)
    if (meta) {
      meta.updatedAt = record.updatedAt
      await this.writeLibrary(library)
    }
  }

  private broadcastChanged(paperId: string): void {
    try {
      this.mainWindow.webContents.send('paper:changed', paperId)
    } catch {
      // window closed
    }
  }

  private async queueWrite(fn: () => Promise<void>): Promise<void> {
    const prev = this.writeLock
    this.writeLock = prev.then(fn).catch((err) => {
      console.error('[Store] write failed:', err)
    })
    await this.writeLock
  }
}

// Convenience: list assets inside a paper folder (for MCP/UI later).
export async function listPaperAssets(
  manager: PaperStoreManager,
  paperId: string
): Promise<{ name: string; size: number }[]> {
  const dir = manager.paperFile(paperId, ASSETS_DIR)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  const out: { name: string; size: number }[] = []
  for (const name of entries) {
    const s = await stat(join(dir, name))
    if (s.isFile()) out.push({ name, size: s.size })
  }
  return out
}
