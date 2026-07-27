import { create } from 'zustand'
import type { TexInstallProgress, TexInstallState } from '@shared/types'

// The state of the app's own TeX installation.
//
// Kept in a store rather than component state because two things ask about
// it — the build panel, which offers to install when a compile fails for
// want of an engine, and the install card itself — and because an install
// runs for minutes across panel opens and closes.

const IDLE: TexInstallProgress = { phase: 'idle', percent: 0, message: '' }

interface TexState extends TexInstallState {
  /** False until the first `getState` lands, so the UI can stay quiet. */
  loaded: boolean
  refresh: () => Promise<void>
  install: () => Promise<void>
  cancel: () => Promise<void>
  remove: () => Promise<void>
  reveal: () => Promise<void>
}

export const useTexStore = create<TexState>()((set) => ({
  loaded: false,
  installed: false,
  installing: false,
  directory: '',
  binDir: null,
  version: null,
  sizeBytes: 0,
  progress: IDLE,
  systemTexAvailable: false,

  refresh: async () => {
    const state = await window.texAPI.getState()
    set({ ...state, loaded: true })
  },

  install: async () => {
    // Optimistic, so the button reacts on the click rather than after the
    // first mirror has answered.
    set({ installing: true, progress: { phase: 'download', percent: 0, message: 'Starting…' } })
    const state = await window.texAPI.install()
    set({ ...state, loaded: true })
  },

  cancel: async () => {
    const state = await window.texAPI.cancel()
    set({ ...state, loaded: true })
  },

  remove: async () => {
    const state = await window.texAPI.remove()
    set({ ...state, loaded: true, progress: IDLE })
  },

  reveal: async () => {
    await window.texAPI.reveal()
  }
}))

/**
 * Subscribe to install progress for the life of the app.
 *
 * Module-level rather than in a hook: progress arrives whether or not the
 * panel that started the install is still mounted, and dropping the updates
 * because a panel closed would leave the bar frozen when it reopened.
 */
export function listenForTexProgress(): () => void {
  return window.texAPI.onProgress((progress) => {
    useTexStore.setState({
      progress,
      installing:
        progress.phase !== 'done' && progress.phase !== 'failed' && progress.phase !== 'idle'
    })
    // A finished install changes what the build panel should offer, and the
    // size and version are only known once it's on disk.
    if (progress.phase === 'done' || progress.phase === 'failed') {
      void useTexStore.getState().refresh()
    }
  })
}
