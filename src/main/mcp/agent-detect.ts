/**
 * Agent auto-detection + 1-click wiring for the MCP connect popover.
 *
 * Instead of asking the user to hand-edit config files, we look for the MCP
 * clients people actually run (Claude Code, Claude Desktop, Cursor, Windsurf,
 * Codex), report whether each is installed and whether this editor is already
 * wired in, and offer a single button to add (or remove) our server by editing
 * that client's own config file.
 *
 * Safety: every edit is a careful MERGE. JSON configs are parsed, augmented with
 * just our entry, and written back (other servers/settings preserved); if a file
 * is present but unparseable we refuse to touch it. The TOML config (Codex) is
 * append/remove-only on our own `[mcp_servers.latex-editor]` block. Our server
 * key is always SERVER_KEY, so connect is idempotent and disconnect is precise.
 */
import { homedir, platform } from 'os'
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import type { DetectedAgent, AgentActionResult } from '../../shared/types'

/** The single config key/section name we own across every client. */
const SERVER_KEY = 'latex-editor'

const HOME = homedir()

/** Roaming AppData on Windows (where Claude Desktop stores its config). */
function appData(): string {
  return process.env.APPDATA || join(HOME, 'AppData', 'Roaming')
}

/** Platform-specific Claude Desktop config path. */
function claudeDesktopConfig(): string {
  switch (platform()) {
    case 'win32':
      return join(appData(), 'Claude', 'claude_desktop_config.json')
    case 'darwin':
      return join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    default:
      return join(HOME, '.config', 'Claude', 'claude_desktop_config.json')
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * One supported client. `installMarkers` are paths whose existence means the
 * client is installed (config file or app dir). For JSON clients, `jsonEntry`
 * builds the value stored under `mcpServers[SERVER_KEY]`. Codex is TOML, handled
 * by the append/remove branch.
 */
interface AgentSpec {
  id: string
  name: string
  hint: string
  format: 'json' | 'toml'
  configPath: string
  installMarkers: string[]
  jsonEntry?: (url: string) => Record<string, unknown>
  /** Body lines under our `[mcp_servers.latex-editor]` header (toml clients). */
  tomlBody?: (url: string) => string
  manual: (url: string) => string
}

function specs(): AgentSpec[] {
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      hint: 'CLI — adds a user-scope MCP server',
      format: 'json',
      configPath: join(HOME, '.claude.json'),
      installMarkers: [join(HOME, '.claude.json'), join(HOME, '.claude')],
      jsonEntry: (url) => ({ type: 'sse', url }),
      manual: (url) => `claude mcp add --transport sse ${SERVER_KEY} "${url}"`
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      hint: 'Bridged over stdio via mcp-remote (needs Node/npx)',
      format: 'json',
      configPath: claudeDesktopConfig(),
      installMarkers: [claudeDesktopConfig(), dirname(claudeDesktopConfig())],
      // Claude Desktop speaks stdio only; mcp-remote proxies our SSE endpoint.
      // Our server is SSE-only, so force sse-only rather than relying on
      // mcp-remote's http-first auto-detection (an extra probe we can skip).
      jsonEntry: (url) => ({
        command: 'npx',
        args: ['mcp-remote', url, '--transport', 'sse-only']
      }),
      manual: (url) =>
        `{
  "mcpServers": {
    "${SERVER_KEY}": {
      "command": "npx",
      "args": ["mcp-remote", "${url}", "--transport", "sse-only"]
    }
  }
}`
    },
    {
      id: 'cursor',
      name: 'Cursor',
      hint: 'Global MCP config (~/.cursor/mcp.json)',
      format: 'json',
      configPath: join(HOME, '.cursor', 'mcp.json'),
      installMarkers: [join(HOME, '.cursor')],
      jsonEntry: (url) => ({ url }),
      manual: (url) =>
        `{
  "mcpServers": {
    "${SERVER_KEY}": { "url": "${url}" }
  }
}`
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      hint: 'Codeium MCP config (~/.codeium/windsurf)',
      format: 'json',
      configPath: join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
      installMarkers: [join(HOME, '.codeium', 'windsurf'), join(HOME, '.codeium')],
      jsonEntry: (url) => ({ serverUrl: url }),
      manual: (url) =>
        `{
  "mcpServers": {
    "${SERVER_KEY}": { "serverUrl": "${url}" }
  }
}`
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      hint: 'Bridged over stdio via mcp-remote (needs Node/npx)',
      format: 'toml',
      configPath: join(HOME, '.codex', 'config.toml'),
      installMarkers: [join(HOME, '.codex', 'config.toml'), join(HOME, '.codex')],
      // Codex's `url` field expects a Streamable-HTTP server; our endpoint is
      // SSE-only, so a direct `url = ...` won't connect. Codex natively runs
      // stdio command servers, so bridge through mcp-remote like Claude Desktop.
      tomlBody: (url) =>
        `command = "npx"\nargs = ["mcp-remote", "${url}", "--transport", "sse-only"]`,
      manual: (url) =>
        `[mcp_servers.${SERVER_KEY}]\ncommand = "npx"\nargs = ["mcp-remote", "${url}", "--transport", "sse-only"]`
    }
  ]
}

/** The exact TOML header line that marks our Codex block. */
const TOML_SECTION = `[mcp_servers.${SERVER_KEY}]`

/** Read a JSON config, returning {} for a missing file and null for a corrupt one. */
async function readJsonConfig(path: string): Promise<Record<string, unknown> | null> {
  if (!(await pathExists(path))) return {}
  try {
    const text = await fs.readFile(path, 'utf8')
    if (!text.trim()) return {}
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return null // present but unparseable — caller must refuse to write
  }
}

/** Is our server wired into this client's config right now? */
async function isConnected(spec: AgentSpec): Promise<boolean> {
  if (spec.format === 'json') {
    const cfg = await readJsonConfig(spec.configPath)
    if (!cfg) return false
    const servers = cfg.mcpServers
    return !!(servers && typeof servers === 'object' && SERVER_KEY in servers)
  }
  // TOML (Codex): look for our section header.
  if (!(await pathExists(spec.configPath))) return false
  try {
    const text = await fs.readFile(spec.configPath, 'utf8')
    return text.includes(TOML_SECTION)
  } catch {
    return false
  }
}

async function toDetected(spec: AgentSpec, url: string): Promise<DetectedAgent> {
  const markers = await Promise.all(spec.installMarkers.map(pathExists))
  const installed = markers.some(Boolean)
  return {
    id: spec.id,
    name: spec.name,
    hint: spec.hint,
    installed,
    connected: installed ? await isConnected(spec) : false,
    configPath: spec.configPath,
    canAutoConnect: true,
    manualSnippet: spec.manual(url)
  }
}

/** Detect every known client and its current wiring against the given URL. */
export async function detectAgents(url: string): Promise<DetectedAgent[]> {
  return Promise.all(specs().map((s) => toDetected(s, url)))
}

function findSpec(id: string): AgentSpec | undefined {
  return specs().find((s) => s.id === id)
}

/** Pretty-print + ensure the parent directory exists before writing. */
async function writeFileEnsuringDir(path: string, contents: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, contents, 'utf8')
}

/** Add our server to a client's config (idempotent). */
export async function connectAgent(id: string, url: string): Promise<AgentActionResult> {
  const spec = findSpec(id)
  if (!spec) return { ok: false, error: `Unknown agent: ${id}` }

  try {
    if (spec.format === 'json') {
      const cfg = await readJsonConfig(spec.configPath)
      if (!cfg) {
        return {
          ok: false,
          error: `${spec.name}'s config isn't valid JSON — open ${spec.configPath} and fix it, or add the server manually.`
        }
      }
      const servers =
        cfg.mcpServers && typeof cfg.mcpServers === 'object'
          ? (cfg.mcpServers as Record<string, unknown>)
          : {}
      servers[SERVER_KEY] = spec.jsonEntry!(url)
      cfg.mcpServers = servers
      await writeFileEnsuringDir(spec.configPath, JSON.stringify(cfg, null, 2) + '\n')
    } else {
      // TOML (Codex): append our block if it's not already there.
      let text = ''
      if (await pathExists(spec.configPath)) text = await fs.readFile(spec.configPath, 'utf8')
      if (!text.includes(TOML_SECTION)) {
        const sep = text.length && !text.endsWith('\n') ? '\n\n' : text.length ? '\n' : ''
        text = `${text}${sep}${TOML_SECTION}\n${spec.tomlBody!(url)}\n`
        await writeFileEnsuringDir(spec.configPath, text)
      }
    }
    return { ok: true, agent: await toDetected(spec, url) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Remove our server from a client's config. */
export async function disconnectAgent(id: string, url: string): Promise<AgentActionResult> {
  const spec = findSpec(id)
  if (!spec) return { ok: false, error: `Unknown agent: ${id}` }

  try {
    if (spec.format === 'json') {
      const cfg = await readJsonConfig(spec.configPath)
      if (!cfg) {
        return {
          ok: false,
          error: `${spec.name}'s config isn't valid JSON — open ${spec.configPath} and remove the server manually.`
        }
      }
      const servers = cfg.mcpServers as Record<string, unknown> | undefined
      if (servers && SERVER_KEY in servers) {
        delete servers[SERVER_KEY]
        await writeFileEnsuringDir(spec.configPath, JSON.stringify(cfg, null, 2) + '\n')
      }
    } else if (await pathExists(spec.configPath)) {
      // TOML: drop our section header and the lines up to the next section/EOF.
      const lines = (await fs.readFile(spec.configPath, 'utf8')).split('\n')
      const start = lines.findIndex((l) => l.trim() === TOML_SECTION)
      if (start !== -1) {
        let end = start + 1
        while (end < lines.length && !lines[end].trim().startsWith('[')) end++
        // Also swallow one blank separator line left dangling above the block.
        const from = start > 0 && lines[start - 1].trim() === '' ? start - 1 : start
        lines.splice(from, end - from)
        await fs.writeFile(spec.configPath, lines.join('\n'), 'utf8')
      }
    }
    return { ok: true, agent: await toDetected(spec, url) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
