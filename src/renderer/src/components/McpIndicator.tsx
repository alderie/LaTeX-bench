import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { McpStatusInfo } from '@shared/types'
import { McpConnectPopover } from './McpConnectPopover'

/**
 * Custom circular loader for the "starting" state — a static track with a
 * sweeping arc on top. The arc's dash length breathes while the whole ring
 * spins, which reads as indeterminate progress rather than a spinning glyph.
 */
function CircularLoader(): React.JSX.Element {
  return (
    <svg className="mcp-loader" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="mcp-loader__track" cx="8" cy="8" r="6" />
      <circle className="mcp-loader__arc" cx="8" cy="8" r="6" />
    </svg>
  )
}

/**
 * Floating MCP status pill, bottom-right corner. Click to open the "Connect an
 * agent" popover; the number of live agent connections rides along as a badge.
 */
export function McpIndicator(): React.JSX.Element {
  const [mcp, setMcp] = useState<McpStatusInfo>({
    state: 'offline',
    port: null,
    url: null,
    agentCount: 0
  })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void window.mcpAPI.getStatus().then(setMcp)
    return window.mcpAPI.onStatusChanged(setMcp)
  }, [])

  const toggleServer = useCallback(async (): Promise<void> => {
    setMcp(await (mcp.state === 'online' ? window.mcpAPI.stop() : window.mcpAPI.start()))
  }, [mcp.state])

  // Opening the panel starts the server if it isn't up yet — the point of the
  // panel is wiring an agent in, and a dead endpoint would make that a no-op.
  const onPillClick = useCallback((): void => {
    setOpen((wasOpen) => {
      if (!wasOpen && mcp.state === 'offline') void window.mcpAPI.start().then(setMcp)
      return !wasOpen
    })
  }, [mcp.state])

  const starting = mcp.state === 'starting'

  let pillCls = 'mcp-indicator'
  if (mcp.state === 'online') pillCls += ' mcp-indicator--ok'
  if (mcp.state === 'error') pillCls += ' mcp-indicator--err'
  if (starting) pillCls += ' mcp-indicator--starting'
  if (open) pillCls += ' mcp-indicator--open'

  const tooltip =
    mcp.state === 'online'
      ? `MCP live at ${mcp.url} · ${mcp.agentCount} agent${mcp.agentCount === 1 ? '' : 's'}`
      : starting
        ? 'MCP server starting…'
        : mcp.state === 'error'
          ? `MCP error: ${mcp.error ?? 'unknown'}`
          : 'MCP server offline — click to start and connect an agent'

  return (
    <div className="mcp-anchor" data-mcp-anchor>
      {open && (
        <McpConnectPopover
          status={mcp}
          onClose={() => setOpen(false)}
          onToggleServer={() => void toggleServer()}
        />
      )}
      <button
        className={pillCls}
        title={tooltip}
        onClick={onPillClick}
        aria-expanded={open}
        aria-label="MCP server and connected agents"
      >
        {starting ? <CircularLoader /> : <span className="mcp-indicator__dot" />}
        MCP
        {mcp.agentCount > 0 && <span className="mcp-indicator__badge">{mcp.agentCount}</span>}
      </button>
    </div>
  )
}
