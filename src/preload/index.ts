import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  BuildResult,
  EngineInfo,
  LatexAPI,
  McpAPI,
  McpStatusInfo,
  PaperAPI,
  PaperMeta,
  PaperSettings,
  SettingsAPI,
  WindowAPI
} from '../shared/types'

const paperAPI: PaperAPI = {
  listPapers: () => ipcRenderer.invoke('paper:list'),
  createPaper: (title: string) => ipcRenderer.invoke('paper:create', title),
  deletePaper: (paperId: string) => ipcRenderer.invoke('paper:delete', paperId),
  renamePaper: (paperId: string, title: string) =>
    ipcRenderer.invoke('paper:rename', paperId, title),
  readTex: (paperId: string) => ipcRenderer.invoke('paper:readTex', paperId),
  writeTex: (paperId: string, tex: string) => ipcRenderer.invoke('paper:writeTex', paperId, tex),
  readBib: (paperId: string) => ipcRenderer.invoke('paper:readBib', paperId),
  writeBib: (paperId: string, bib: string) => ipcRenderer.invoke('paper:writeBib', paperId, bib),
  getSettings: (paperId: string) => ipcRenderer.invoke('paper:getSettings', paperId),
  saveSettings: (paperId: string, settings: PaperSettings) =>
    ipcRenderer.invoke('paper:saveSettings', paperId, settings),
  onChanged: (cb: (paperId: string) => void) => {
    const listener = (_: unknown, paperId: string) => cb(paperId)
    ipcRenderer.on('paper:changed', listener)
    return () => {
      ipcRenderer.removeListener('paper:changed', listener)
    }
  }
}

const latexAPI: LatexAPI = {
  detectEngines: () => ipcRenderer.invoke('latex:detectEngines'),
  build: (paperId: string) => ipcRenderer.invoke('latex:build', paperId),
  cancel: (paperId: string) => ipcRenderer.invoke('latex:cancel', paperId),
  readPdf: (paperId: string) => ipcRenderer.invoke('latex:readPdf', paperId),
  onProgress: (cb) => {
    const listener = (_: unknown, e: { paperId: string; line: string }) => cb(e)
    ipcRenderer.on('latex:build-progress', listener)
    return () => ipcRenderer.removeListener('latex:build-progress', listener)
  },
  onComplete: (cb) => {
    const listener = (_: unknown, e: BuildResult) => cb(e)
    ipcRenderer.on('latex:build-complete', listener)
    return () => ipcRenderer.removeListener('latex:build-complete', listener)
  }
}

const mcpAPI: McpAPI = {
  start: () => ipcRenderer.invoke('mcp:start'),
  stop: () => ipcRenderer.invoke('mcp:stop'),
  getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  onStatusChanged: (cb) => {
    const listener = (_: unknown, status: McpStatusInfo) => cb(status)
    ipcRenderer.on('mcp:status-changed', listener)
    return () => ipcRenderer.removeListener('mcp:status-changed', listener)
  }
}

const settingsAPI: SettingsAPI = {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings)
}

const windowAPI: WindowAPI = {
  setTitleBarOverlay: (overlay) => ipcRenderer.invoke('window:setTitleBarOverlay', overlay)
}

// Expose APIs only with context isolation enabled (default). Fallback to
// global assignment for the unlikely case someone disables it.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('paperAPI', paperAPI)
    contextBridge.exposeInMainWorld('latexAPI', latexAPI)
    contextBridge.exposeInMainWorld('mcpAPI', mcpAPI)
    contextBridge.exposeInMainWorld('settingsAPI', settingsAPI)
    contextBridge.exposeInMainWorld('windowAPI', windowAPI)
  } catch (err) {
    console.error('[preload] contextBridge exposure failed:', err)
  }
} else {
  // @ts-ignore — fallback for sandbox: false + contextIsolation: false
  window.electron = electronAPI
  // @ts-ignore
  window.paperAPI = paperAPI
  // @ts-ignore
  window.latexAPI = latexAPI
  // @ts-ignore
  window.mcpAPI = mcpAPI
  // @ts-ignore
  window.settingsAPI = settingsAPI
  // @ts-ignore
  window.windowAPI = windowAPI
}

// Re-export types for tooling — not actually emitted by tsc since this file
// is consumed at runtime via electron-vite's preload build.
export type { PaperAPI, LatexAPI, McpAPI, SettingsAPI, WindowAPI, EngineInfo, PaperMeta }
