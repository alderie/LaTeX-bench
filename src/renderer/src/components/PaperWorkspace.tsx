import * as React from 'react'
import { Suspense, lazy } from 'react'
import { SidePanel } from './SidePanel'
import { EditorPane } from './EditorPane'
import { MainHeader } from './MainHeader'
import { FindBar } from './FindBar'
import { McpIndicator } from './McpIndicator'
import { useUiStore } from '../stores/uiStore'

// Heavy overlays load on demand.
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette }))
)
const SymbolPalette = lazy(() =>
  import('./SymbolPalette').then((m) => ({ default: m.SymbolPalette }))
)

export function PaperWorkspace(): React.JSX.Element {
  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const symbolPaletteOpen = useUiStore((s) => s.symbolPaletteOpen)

  return (
    <div className="app">
      <SidePanel />
      <div className="main-content-wrapper">
        <MainHeader />
        <EditorPane />
      </div>
      <FindBar />
      <McpIndicator />
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {symbolPaletteOpen && (
        <Suspense fallback={null}>
          <SymbolPalette />
        </Suspense>
      )}
    </div>
  )
}
