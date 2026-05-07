import './App.css'
import * as React from 'react'
import { useEffect } from 'react'
import { PaperWorkspace } from './components/PaperWorkspace'
import { useBuild } from './hooks/useBuild'
import { useShortcuts } from './hooks/useShortcuts'

export default function App(): React.JSX.Element {
  useBuild()
  useShortcuts()

  // Sync the title-bar overlay color with the resolved theme attribute.
  useEffect(() => {
    const apply = (): void => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      window.windowAPI
        ?.setTitleBarOverlay({
          color: dark ? '#1a1a1c' : '#ffffff',
          symbolColor: dark ? '#f2f2f4' : '#111111'
        })
        .catch(() => undefined)
    }
    apply()
    const obs = new MutationObserver(apply)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // Send a one-shot ping so the main process logs `pong` on first boot —
  // a sanity check that contextBridge wiring is alive.
  useEffect(() => {
    window.electron?.ipcRenderer?.send('ping')
  }, [])

  return <PaperWorkspace />
}
