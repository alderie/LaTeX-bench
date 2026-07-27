import * as React from 'react'
import { useEffect, useState } from 'react'

// In-app minimise / maximise / close buttons. The window is frameless on
// Windows and Linux (no native titleBarOverlay), so these are the only
// window controls. macOS keeps its own traffic lights, so we render nothing
// there.
//
// The glyphs are drawn here rather than taken from the icon set. Lucide's
// shapes are designed for 24px with rounded joins; at the 10px a caption
// button wants, `Square` and `Copy` read as a blurred blob and a pair of
// pages. These are plain strokes on a 10×10 grid, which is the size the
// Windows and GNOME conventions both use, so they stay crisp.
const isMac = navigator.userAgent.includes('Macintosh')

function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  )
}

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
        <Glyph>
          <path d="M1 5h8" />
        </Glyph>
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
          <Glyph>
            {/* Restore: the window stepping back out from under the edge. */}
            <path d="M3 3V1.6h5.4V7H7" />
            <rect x="1.4" y="3" width="5.6" height="5.6" rx="1.2" />
          </Glyph>
        ) : (
          <Glyph>
            <rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1.4" />
          </Glyph>
        )}
      </button>

      <button
        className="window-control window-control--close"
        onClick={() => void window.windowAPI?.close()}
        title="Close"
        aria-label="Close"
      >
        <Glyph>
          <path d="m1.4 1.4 7.2 7.2" />
          <path d="m8.6 1.4-7.2 7.2" />
        </Glyph>
      </button>
    </div>
  )
}
