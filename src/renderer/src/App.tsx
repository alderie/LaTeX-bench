import './App.css'
import * as React from 'react'
import { useEffect } from 'react'
import { PaperWorkspace } from './components/PaperWorkspace'
import { useBibliography } from './hooks/useBibliography'
import { listenForTexProgress } from './stores/texStore'
import { useBuild } from './hooks/useBuild'
import { useShortcuts } from './hooks/useShortcuts'
import { useZoomGesture } from './hooks/useZoomGesture'

export default function App(): React.JSX.Element {
  useBuild()
  useBibliography()
  useShortcuts()
  useZoomGesture()

  // Install progress arrives whether or not the panel that started it is
  // still mounted, so the listener lives as long as the app does.
  useEffect(() => listenForTexProgress(), [])

  // Keep the native window background in sync with the resolved theme, so
  // resizing doesn't reveal a white edge in dark mode. The window buttons
  // themselves are rendered in-app by WindowControls.
  useEffect(() => {
    const apply = (): void => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      window.windowAPI?.setChromeColor(dark ? '#1a1a1c' : '#ffffff').catch(() => undefined)
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
