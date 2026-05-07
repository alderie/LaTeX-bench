import * as React from 'react'
import { useEffect, useState } from 'react'
import { useUiStore } from '../stores/uiStore'
import type { McpStatusInfo } from '@shared/types'

// Floating MCP server status pill, bottom-right corner. Click to start/stop
// the server. Shifts left when the preview pane is docked so it stays in
// the visible (non-overlay) area.

export function McpIndicator(): React.JSX.Element {
  const previewOpen = useUiStore((s) => s.previewOpen)
  const previewFullscreen = useUiStore((s) => s.previewFullscreen)

  const [mcp, setMcp] = useState<McpStatusInfo>({
    state: 'offline',
    port: null,
    url: null,
    agentCount: 0
  })

  useEffect(() => {
    void window.mcpAPI.getStatus().then(setMcp)
    return window.mcpAPI.onStatusChanged(setMcp)
  }, [])

  const onClick = async (): Promise<void> => {
    setMcp(await (mcp.state === 'online' ? window.mcpAPI.stop() : window.mcpAPI.start()))
  }

  let pillCls = 'mcp-indicator'
  if (mcp.state === 'online') pillCls += ' mcp-indicator--ok'
  if (mcp.state === 'error') pillCls += ' mcp-indicator--err'
  if (previewOpen && !previewFullscreen) pillCls += ' mcp-indicator--shifted'
  if (previewFullscreen) pillCls += ' mcp-indicator--hidden'

  const tooltip =
    mcp.state === 'online'
      ? `MCP live at ${mcp.url} · ${mcp.agentCount} agent${mcp.agentCount === 1 ? '' : 's'} (click to stop)`
      : mcp.state === 'starting'
        ? 'MCP server starting…'
        : mcp.state === 'error'
          ? `MCP error: ${mcp.error ?? 'unknown'} (click to retry)`
          : 'MCP server offline (click to start)'

  return (
    <button className={pillCls} title={tooltip} onClick={onClick} aria-label="Toggle MCP server">
      <span className="mcp-indicator__dot" />
      MCP
      {mcp.state === 'online' ? ` · ${mcp.agentCount}` : ''}
    </button>
  )
}
