import { app, shell, BrowserWindow, ipcMain, Menu, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { AppSettings, McpStatusInfo } from '../shared/types'
import { initStores, whenStoresReady, getSettingsStore, PaperStoreManager } from './store'
import { registerPaperProtocol } from './paper/protocol'

// Type-only imports keep heavy modules out of cold-start.
import type { McpPaperServer } from './mcp/mcp-server'
import type { LatexCompiler } from './latex/compiler'

let mainWindow: BrowserWindow | null = null
let storeManager: PaperStoreManager | null = null
let mcpServer: McpPaperServer | null = null
let compiler: LatexCompiler | null = null

let currentTitleBarOverlay: { color: string; symbolColor: string } = {
  color: '#ffffff',
  symbolColor: '#111111'
}
const backgroundColorForOverlay = (): string =>
  currentTitleBarOverlay.color === '#ffffff' ? '#ffffff' : '#1a1a1c'

// ── Lazy module accessors ────────────────────────────────────────────────

async function getCompiler(): Promise<LatexCompiler> {
  if (!compiler) {
    const { LatexCompiler } = await import('./latex/compiler')
    compiler = new LatexCompiler(mainWindow!)
  }
  return compiler
}

async function getMcpServer(): Promise<McpPaperServer> {
  if (!mcpServer) {
    const { McpPaperServer } = await import('./mcp/mcp-server')
    await whenStoresReady()
    mcpServer = new McpPaperServer(storeManager!, mainWindow!, {
      onStatusChanged: (status: McpStatusInfo) =>
        mainWindow?.webContents.send('mcp:status-changed', status)
    })
  }
  return mcpServer
}

// ── Custom protocol registration (must be before app.whenReady) ──────────

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'paper',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      stream: true
    }
  }
])

// ── Window creation ──────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'synthetic-corbato',
    autoHideMenuBar: true,
    backgroundColor: backgroundColorForOverlay(),
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...currentTitleBarOverlay, height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  electronApp.setAppUserModelId('com.synthetic-corbato.app')

  initStores().catch((err) => console.error('[App] initStores failed:', err))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  // PaperStoreManager is fs-only — safe to construct before electron-store loads.
  storeManager = new PaperStoreManager(app.getPath('userData'), mainWindow!)
  registerPaperProtocol(storeManager)

  // ── Settings ──
  ipcMain.handle('settings:load', async (): Promise<AppSettings> => {
    await whenStoresReady()
    return getSettingsStore().store
  })

  ipcMain.handle('settings:save', async (_, settings: AppSettings): Promise<void> => {
    await whenStoresReady()
    getSettingsStore().store = settings
  })

  // ── Window chrome ──
  ipcMain.handle(
    'window:setTitleBarOverlay',
    async (_, overlay: { color: string; symbolColor: string }) => {
      currentTitleBarOverlay = overlay
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.setTitleBarOverlay({ ...overlay, height: 36 })
        } catch {
          // Window not constructed with the overlay style — ignore.
        }
      }
    }
  )

  // ── Paper library / IO ──
  ipcMain.handle('paper:list', async () => storeManager!.listPapers())

  ipcMain.handle('paper:create', async (_, title: string) =>
    storeManager!.createPaper(title)
  )

  ipcMain.handle('paper:delete', async (_, paperId: string) =>
    storeManager!.deletePaper(paperId)
  )

  ipcMain.handle('paper:rename', async (_, paperId: string, title: string) =>
    storeManager!.renamePaper(paperId, title)
  )

  ipcMain.handle('paper:readTex', async (_, paperId: string) =>
    storeManager!.readTex(paperId)
  )

  ipcMain.handle('paper:writeTex', async (_, paperId: string, tex: string) =>
    storeManager!.writeTex(paperId, tex)
  )

  ipcMain.handle('paper:readBib', async (_, paperId: string) =>
    storeManager!.readBib(paperId)
  )

  ipcMain.handle('paper:writeBib', async (_, paperId: string, bib: string) =>
    storeManager!.writeBib(paperId, bib)
  )

  ipcMain.handle('paper:getSettings', async (_, paperId: string) =>
    storeManager!.getSettings(paperId)
  )

  ipcMain.handle(
    'paper:saveSettings',
    async (_, paperId: string, settings) => storeManager!.saveSettings(paperId, settings)
  )

  // ── LaTeX compilation (lazy) ──
  ipcMain.handle('latex:detectEngines', async () => {
    const { detectEngines } = await import('./latex/engine-detect')
    return detectEngines()
  })

  ipcMain.handle('latex:build', async (_, paperId: string) =>
    (await getCompiler()).build(paperId, storeManager!)
  )

  ipcMain.handle('latex:cancel', async (_, paperId: string) => {
    if (!compiler) return
    return compiler.cancel(paperId)
  })

  ipcMain.handle('latex:readPdf', async (_, paperId: string) =>
    storeManager!.readPdf(paperId)
  )

  // ── MCP server (lazy) ──
  ipcMain.handle('mcp:start', async () => (await getMcpServer()).start(7332))

  ipcMain.handle('mcp:stop', async () => {
    if (!mcpServer) return { state: 'offline', port: null, agentCount: 0, url: null }
    return mcpServer.stop()
  })

  ipcMain.handle('mcp:getStatus', async () => {
    if (!mcpServer)
      return { state: 'offline', port: null, agentCount: 0, url: null } as McpStatusInfo
    return mcpServer.getStatus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function cleanupServices(): void {
  if (compiler) compiler.destroy()
  if (mcpServer) mcpServer.stop().catch(() => undefined)
}

app.on('before-quit', cleanupServices)
app.on('will-quit', cleanupServices)
process.on('SIGINT', () => {
  cleanupServices()
  app.quit()
})
process.on('SIGTERM', () => {
  cleanupServices()
  app.quit()
})
