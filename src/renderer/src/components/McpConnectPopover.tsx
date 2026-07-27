import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Boxes,
  Check,
  ChevronDown,
  MonitorSmartphone,
  Plus,
  Power,
  RefreshCw,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import type { DetectedAgent, McpStatusInfo } from '@shared/types'

interface McpConnectPopoverProps {
  status: McpStatusInfo
  onClose: () => void
  onToggleServer: () => void
}

/** Per-client glyph for the agent rows (falls back to a generic box). */
const AGENT_ICONS: Record<string, LucideIcon> = {
  'claude-code': Terminal,
  'claude-desktop': MonitorSmartphone,
  cursor: Boxes,
  windsurf: Boxes,
  codex: Terminal
}

/** Copy-to-clipboard affordance that flips to "Copied" briefly. */
function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="mcp-pop__copy"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
          .catch(() => {})
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/**
 * A single detected client: name, hint, live connection state and a one-click
 * Connect / Disconnect button that edits the client's own config file. Errors
 * (e.g. an unparseable config) surface inline beneath the row.
 */
function AgentRow({
  agent,
  busy,
  error,
  onConnect,
  onDisconnect
}: {
  agent: DetectedAgent
  busy: boolean
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  const Icon = AGENT_ICONS[agent.id] ?? Boxes
  return (
    <div className={'mcp-agent' + (agent.connected ? ' mcp-agent--connected' : '')}>
      <div className="mcp-agent__main">
        <span className="mcp-agent__icon" aria-hidden>
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <div className="mcp-agent__text">
          <span className="mcp-agent__name">{agent.name}</span>
          <span className="mcp-agent__hint">
            {agent.connected ? (
              <>
                <Check className="mcp-agent__check" size={11} strokeWidth={3} aria-hidden />
                Connected to this editor
              </>
            ) : (
              agent.hint
            )}
          </span>
        </div>
        {agent.connected ? (
          <button
            type="button"
            className="mcp-agent__btn mcp-agent__btn--disconnect"
            onClick={onDisconnect}
            disabled={busy}
          >
            {busy ? 'Removing…' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            className="mcp-agent__btn mcp-agent__btn--primary"
            onClick={onConnect}
            disabled={busy}
          >
            {busy ? (
              'Connecting…'
            ) : (
              <>
                <Plus size={13} strokeWidth={2.5} aria-hidden />
                Connect
              </>
            )}
          </button>
        )}
      </div>
      {error && <p className="mcp-agent__error">{error}</p>}
    </div>
  )
}

/**
 * "Connect an agent" popover, anchored above the floating MCP pill. Auto-detects
 * the MCP clients installed on this machine (Claude Code, Claude Desktop, Cursor,
 * Windsurf, Codex), shows whether this editor is already wired into each, and
 * offers one-click connect/disconnect that edits the client's own config. The
 * endpoint and copy-paste snippets live behind a disclosure as the fallback.
 */
export function McpConnectPopover({
  status,
  onClose,
  onToggleServer
}: McpConnectPopoverProps): React.JSX.Element {
  const [agents, setAgents] = useState<DetectedAgent[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showSetup, setShowSetup] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      setAgents(await window.mcpAPI.detectAgents())
    } catch {
      setAgents([])
    }
  }, [])

  // Detect on open and whenever the server status flips (URL/online changes).
  useEffect(() => {
    void refresh()
  }, [refresh, status.state, status.url])

  // Escape closes; so does a click anywhere outside the popover. The pill's own
  // handler runs first and toggles, so it is excluded via `data-mcp-anchor`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      if (rootRef.current?.contains(target ?? null)) return
      if (target?.closest('[data-mcp-anchor]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const act = useCallback(async (agent: DetectedAgent, connect: boolean) => {
    setBusyId(agent.id)
    setErrors((e) => {
      if (!(agent.id in e)) return e
      const rest = { ...e }
      delete rest[agent.id]
      return rest
    })
    try {
      const res = connect
        ? await window.mcpAPI.connectAgent(agent.id)
        : await window.mcpAPI.disconnectAgent(agent.id)
      if (res.ok && res.agent) {
        const next = res.agent
        setAgents((list) => (list ?? []).map((a) => (a.id === agent.id ? next : a)))
      } else if (!res.ok) {
        setErrors((e) => ({ ...e, [agent.id]: res.error ?? 'Something went wrong.' }))
      }
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [agent.id]: err instanceof Error ? err.message : 'Something went wrong.'
      }))
    } finally {
      setBusyId(null)
    }
  }, [])

  const url = status.url ?? 'http://localhost:7332/sse'
  const online = status.state === 'online'

  const installed = (agents ?? []).filter((a) => a.installed)
  const others = (agents ?? []).filter((a) => !a.installed)

  // Quiet, word-based status in place of a loud colored dot.
  const subtitle =
    agents === null
      ? 'Scanning for agents…'
      : status.state === 'starting'
        ? 'Server starting…'
        : status.state === 'error'
          ? `Server error: ${status.error ?? 'unknown'}`
          : `${online ? `Server online on :${status.port}` : 'Server offline'}${
              installed.length ? ` · ${installed.length} client${installed.length === 1 ? '' : 's'} found` : ''
            }`

  return (
    <div
      className="mcp-pop"
      role="dialog"
      aria-label="Connect an agent"
      ref={rootRef}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="mcp-pop__head">
        <div className="mcp-pop__head-text">
          <h2 className="mcp-pop__title">Connect an agent</h2>
          <span className="mcp-pop__subtitle">{subtitle}</span>
        </div>
        <div className="mcp-pop__head-actions">
          <button
            className="mcp-pop__icon-btn"
            onClick={() => void refresh()}
            aria-label="Rescan for agents"
            title="Rescan"
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden />
          </button>
          <button
            className={'mcp-pop__icon-btn' + (online ? ' is-on' : '')}
            onClick={onToggleServer}
            aria-label={online ? 'Stop MCP server' : 'Start MCP server'}
            title={online ? 'Stop server' : 'Start server'}
          >
            <Power size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </header>

      {agents === null ? (
        <div className="mcp-pop__loading">
          <span className="mcp-pop__spinner" aria-hidden />
          Scanning for agents…
        </div>
      ) : (
        <>
          {installed.length > 0 ? (
            <div className="mcp-pop__agents">
              {installed.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  busy={busyId === a.id}
                  error={errors[a.id] ?? null}
                  onConnect={() => void act(a, true)}
                  onDisconnect={() => void act(a, false)}
                />
              ))}
            </div>
          ) : (
            <p className="mcp-pop__empty">
              No MCP clients detected. Open the setup below to connect one manually.
            </p>
          )}

          <section className="mcp-pop__group">
            <button
              type="button"
              className={'mcp-pop__disclosure' + (showSetup ? ' is-open' : '')}
              onClick={() => setShowSetup((s) => !s)}
              aria-expanded={showSetup}
            >
              <ChevronDown size={14} strokeWidth={2.5} aria-hidden />
              Endpoint &amp; manual setup
            </button>
            {showSetup && (
              <div className="mcp-pop__details">
                {!online && (
                  <p className="mcp-pop__note">
                    The server isn&rsquo;t running yet — clients attach as soon as you start it.
                  </p>
                )}

                <div className="mcp-pop__url">
                  <span className="mcp-pop__url-label">Endpoint</span>
                  <code className="mcp-pop__url-code">{url}</code>
                  <CopyButton text={url} />
                </div>

                {others.length > 0 && (
                  <div className="mcp-pop__others">
                    {others.map((a) => (
                      <div key={a.id} className="mcp-pop__other">
                        <div className="mcp-pop__other-head">
                          <h4 className="mcp-pop__other-name">{a.name}</h4>
                          <CopyButton text={a.manualSnippet} />
                        </div>
                        <pre className="mcp-pop__code">
                          <code>{a.manualSnippet}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

                <p className="mcp-pop__foot">
                  Connected agents can list, read, edit and compile your papers over MCP.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
