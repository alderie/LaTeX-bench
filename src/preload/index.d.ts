import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  PaperAPI,
  LatexAPI,
  McpAPI,
  SettingsAPI,
  WindowAPI
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    paperAPI: PaperAPI
    latexAPI: LatexAPI
    mcpAPI: McpAPI
    settingsAPI: SettingsAPI
    windowAPI: WindowAPI
  }
}

export {}
