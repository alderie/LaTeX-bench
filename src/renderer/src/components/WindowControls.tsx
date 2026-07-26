import * as React from 'react'
import { useEffect, useState } from 'react'

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
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
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
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        )}
      </button>

      <button
        className="window-control window-control--close"
        onClick={() => void window.windowAPI?.close()}
        title="Close"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
    </div>
  )
}
