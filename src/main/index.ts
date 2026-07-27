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

// Tracks the resolved theme so a window created later starts with the
// right background instead of flashing white.
let currentChromeColor = '#ffffff'

function broadcastWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send('window:state-changed', {
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen()
  })
}

// ── Lazy module accessors ────────────────────────────────────────────────

async function getCompiler(): Promise<LatexCompiler> {
  if (!compiler) {
    const { LatexCompiler } = await import('./latex/compiler')
    compiler = new LatexCompiler(mainWindow!)
  }
  return compiler
}

/** Fixed port the MCP server binds to — also baked into the configs we write. */
const MCP_PORT = 7332

/** The SSE endpoint agents connect to, known even while the server is offline. */
function mcpEndpoint(): string {
  return mcpServer?.getStatus().url ?? `http://localhost:${MCP_PORT}/sse`
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
    backgroundColor: currentChromeColor,
    // Frameless with no titleBarOverlay: the minimise / maximise / close
    // buttons are drawn by the renderer (see WindowControls) so they can
    // match the app's own styling. macOS keeps its traffic lights, which
    // sit inset in the top-left.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 22 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Keep the renderer's maximise/restore glyph in sync with reality —
  // the window can also be snapped or double-click-maximised by the OS.
  const win = mainWindow
  const sync = (): void => broadcastWindowState(win)
  win.on('maximize', sync)
  win.on('unmaximize', sync)
  win.on('enter-full-screen', sync)
  win.on('leave-full-screen', sync)

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
  // The renderer reports the resolved theme colour so a window opened
  // later (or a reload) doesn't flash the wrong background.
  ipcMain.handle('window:setChromeColor', async (_, color: string) => {
    currentChromeColor = color
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.setBackgroundColor(color)
      } catch {
        // Not fatal — this is cosmetic.
      }
    }
  })

  const windowFor = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)

  ipcMain.handle('window:minimize', async (e) => windowFor(e)?.minimize())

  ipcMain.handle('window:toggleMaximize', async (e) => {
    const win = windowFor(e)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('window:close', async (e) => windowFor(e)?.close())

  ipcMain.handle('window:getState', async (e) => {
    const win = windowFor(e)
    return {
      maximized: win?.isMaximized() ?? false,
      fullScreen: win?.isFullScreen() ?? false
    }
  })

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

  ipcMain.handle('paper:readTexFile', async (_, paperId: string, relPath: string) =>
    storeManager!.readTexFile(paperId, relPath)
  )

  ipcMain.handle(
    'paper:writeTexFile',
    async (_, paperId: string, relPath: string, tex: string) =>
      storeManager!.writeTexFile(paperId, relPath, tex)
  )

  ipcMain.handle('paper:texFileExists', async (_, paperId: string, relPath: string) =>
    storeManager!.texFileExists(paperId, relPath)
  )

  ipcMain.handle('paper:listTexFiles', async (_, paperId: string) =>
    storeManager!.listTexFiles(paperId)
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
  ipcMain.handle('mcp:start', async () => (await getMcpServer()).start(MCP_PORT))

  ipcMain.handle('mcp:stop', async () => {
    if (!mcpServer) return { state: 'offline', port: null, agentCount: 0, url: null }
    return mcpServer.stop()
  })

  ipcMain.handle('mcp:getStatus', async () => {
    if (!mcpServer)
      return { state: 'offline', port: null, agentCount: 0, url: null } as McpStatusInfo
    return mcpServer.getStatus()
  })

  // ── Agent auto-detection + 1-click wiring ──
  // The config we write points at the fixed endpoint, so these work whether or
  // not the server happens to be running right now.
  ipcMain.handle('mcp:detectAgents', async () => {
    const { detectAgents } = await import('./mcp/agent-detect')
    return detectAgents(mcpEndpoint())
  })

  ipcMain.handle('mcp:connectAgent', async (_, id: string) => {
    const { connectAgent } = await import('./mcp/agent-detect')
    return connectAgent(id, mcpEndpoint())
  })

  ipcMain.handle('mcp:disconnectAgent', async (_, id: string) => {
    const { disconnectAgent } = await import('./mcp/agent-detect')
    return disconnectAgent(id, mcpEndpoint())
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
