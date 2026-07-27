import * as React from 'react'
import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

// In-app minimise / maximise / close buttons. The window is frameless on
// Windows and Linux (no native titleBarOverlay), so these are the only
// window controls — they live in the main header and are styled with the
// rest of the app. macOS keeps its own traffic lights, so we render
// nothing there.
const isMac = navigator.userAgent.includes('Macintosh')

export function WindowControls(): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return undefined
    window.windowAPI
      ?.getState()
      .then((s) => setMaximized(s.maximized))
      .catch(() => undefined)
    // The OS can maximise the window without going through our buttons
    // (snap, double-click on the drag region), so follow the real state.
    return window.windowAPI?.onStateChanged((s) => setMaximized(s.maximized))
  }, [])

  if (isMac) return null

  return (
    <div className="window-controls">
      <button
        className="window-control"
        onClick={() => void window.windowAPI?.minimize()}
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus size={15} strokeWidth={1.5} aria-hidden />
      </button>

      <button
        className="window-control"
        onClick={() =>
          void window.windowAPI
            ?.toggleMaximize()
            .then(setMaximized)
            .catch(() => undefined)
        }
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <Copy size={13} strokeWidth={1.5} aria-hidden />
        ) : (
          <Square size={12} strokeWidth={1.5} aria-hidden />
        )}
      </button>

      <button
        className="window-control window-control--close"
        onClick={() => void window.windowAPI?.close()}
        title="Close"
        aria-label="Close"
      >
        <X size={15} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  )
}
