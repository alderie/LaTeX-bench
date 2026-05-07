import type { BrowserWindow } from 'electron'
import type { Server as HttpServer } from 'http'
import type { McpStatusInfo } from '../../shared/types'
import type { PaperStoreManager } from '../store'
import { toolDefinitions } from './mcp-tool-definitions'
import {
  appendBeforeEndDocument,
  findSection,
  listSections,
  replaceRange,
  searchText
} from './section-utils'

export interface McpHooks {
  onStatusChanged?: (status: McpStatusInfo) => void
}

interface SdkModules {
  Server: any
  SSEServerTransport: any
  ListToolsRequestSchema: any
  CallToolRequestSchema: any
}

export class McpPaperServer {
  private status: McpStatusInfo = { state: 'offline', port: null, url: null, agentCount: 0 }
  private httpServer: HttpServer | null = null
  private transports = new Map<string, any>()
  private servers = new Map<string, any>()
  private sdk: SdkModules | null = null

  constructor(
    private store: PaperStoreManager,
    private mainWindow: BrowserWindow,
    private hooks: McpHooks = {}
  ) {}

  getStatus(): McpStatusInfo {
    return { ...this.status }
  }

  async start(port: number): Promise<McpStatusInfo> {
    if (this.status.state === 'online') return this.getStatus()

    this.status = { ...this.status, state: 'starting' }
    this.hooks.onStatusChanged?.(this.status)

    try {
      // Lazy-load Express, cors, and the SDK so cold-start doesn't pay
      // for them when the user never enables MCP.
      const [express, cors, sdkServerMod, sdkSseMod, sdkTypesMod] = await Promise.all([
        import('express'),
        import('cors'),
        import('@modelcontextprotocol/sdk/server'),
        import('@modelcontextprotocol/sdk/server/sse.js'),
        import('@modelcontextprotocol/sdk/types.js')
      ])
      this.sdk = {
        Server: (sdkServerMod as any).Server,
        SSEServerTransport: (sdkSseMod as any).SSEServerTransport,
        ListToolsRequestSchema: (sdkTypesMod as any).ListToolsRequestSchema,
        CallToolRequestSchema: (sdkTypesMod as any).CallToolRequestSchema
      }

      const app = (express as any).default()
      app.use((cors as any).default())
      app.use((express as any).default.json({ limit: '8mb' }))

      app.get('/sse', async (_req: any, res: any) => {
        const transport = new this.sdk!.SSEServerTransport('/message', res)
        const sessionId = transport.sessionId
        this.transports.set(sessionId, transport)
        const server = this.createMcpServer()
        this.servers.set(sessionId, server)
        this.bumpAgentCount()
        res.on('close', () => {
          this.transports.delete(sessionId)
          this.servers.delete(sessionId)
          this.bumpAgentCount()
        })
        await server.connect(transport)
      })

      app.post('/message', async (req: any, res: any) => {
        const sessionId = req.query.sessionId as string
        const transport = this.transports.get(sessionId)
        if (!transport) {
          res.status(404).json({ error: 'Session not found' })
          return
        }
        await transport.handlePostMessage(req, res, req.body)
      })

      app.get('/health', (_req: any, res: any) => res.json(this.getStatus()))

      await new Promise<void>((resolve, reject) => {
        this.httpServer = app.listen(port, () => resolve())
        this.httpServer!.on('error', reject)
      })

      this.status = {
        state: 'online',
        port,
        url: `http://localhost:${port}/sse`,
        agentCount: 0
      }
      this.hooks.onStatusChanged?.(this.status)
      return this.getStatus()
    } catch (err) {
      this.status = {
        state: 'error',
        port: null,
        url: null,
        agentCount: 0,
        error: (err as Error).message
      }
      this.hooks.onStatusChanged?.(this.status)
      return this.getStatus()
    }
  }

  async stop(): Promise<McpStatusInfo> {
    if (this.httpServer) {
      for (const server of this.servers.values()) {
        try {
          await server.close()
        } catch {
          /* ignore */
        }
      }
      this.servers.clear()
      this.transports.clear()

      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
      })
      this.httpServer = null
    }
    this.status = { state: 'offline', port: null, url: null, agentCount: 0 }
    this.hooks.onStatusChanged?.(this.status)
    return this.getStatus()
  }

  private bumpAgentCount(): void {
    this.status = { ...this.status, agentCount: this.transports.size }
    this.hooks.onStatusChanged?.(this.status)
  }

  private createMcpServer(): any {
    const server = new this.sdk!.Server(
      { name: 'synthetic-corbato', version: '0.1.0' },
      { capabilities: { tools: {} } }
    )

    server.setRequestHandler(this.sdk!.ListToolsRequestSchema, async () => ({
      tools: toolDefinitions
    }))

    server.setRequestHandler(this.sdk!.CallToolRequestSchema, async (req: any) => {
      const name = req.params.name as string
      const args = (req.params.arguments ?? {}) as Record<string, unknown>
      try {
        const result = await this.dispatchTool(name, args)
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
        }
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }]
        }
      }
    })

    return server
  }

  private async dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'list_papers':
        return await this.store.listPapers()

      case 'read_paper': {
        const paperId = requireString(args, 'paperId')
        return await this.store.readTex(paperId)
      }

      case 'list_sections': {
        const paperId = requireString(args, 'paperId')
        const tex = await this.store.readTex(paperId)
        return listSections(tex).map(({ level, title, offset, endOffset, line }) => ({
          level,
          title,
          offset,
          endOffset,
          line
        }))
      }

      case 'read_section': {
        const paperId = requireString(args, 'paperId')
        const offset = requireInt(args, 'sectionOffset')
        const tex = await this.store.readTex(paperId)
        const ref = findSection(tex, offset)
        if (!ref) throw new Error(`No section at offset ${offset}`)
        return tex.slice(ref.offset, ref.endOffset)
      }

      case 'update_section': {
        const paperId = requireString(args, 'paperId')
        const offset = requireInt(args, 'sectionOffset')
        const latex = requireString(args, 'latex')
        const tex = await this.store.readTex(paperId)
        const ref = findSection(tex, offset)
        if (!ref) throw new Error(`No section at offset ${offset}`)
        const updated = replaceRange(tex, ref.offset, ref.endOffset, latex.trimEnd() + '\n\n')
        await this.store.writeTexExternal(paperId, updated)
        return { ok: true, newLength: updated.length }
      }

      case 'replace_range': {
        const paperId = requireString(args, 'paperId')
        const from = requireInt(args, 'from')
        const to = requireInt(args, 'to')
        const latex = requireString(args, 'latex')
        const tex = await this.store.readTex(paperId)
        const updated = replaceRange(tex, from, to, latex)
        await this.store.writeTexExternal(paperId, updated)
        return { ok: true, newLength: updated.length }
      }

      case 'append_to_paper': {
        const paperId = requireString(args, 'paperId')
        const latex = requireString(args, 'latex')
        const tex = await this.store.readTex(paperId)
        const updated = appendBeforeEndDocument(tex, latex)
        await this.store.writeTexExternal(paperId, updated)
        return { ok: true, newLength: updated.length }
      }

      case 'read_references': {
        const paperId = requireString(args, 'paperId')
        return await this.store.readBib(paperId)
      }

      case 'add_reference': {
        const paperId = requireString(args, 'paperId')
        const bibtex = requireString(args, 'bibtex')
        const cur = await this.store.readBib(paperId)
        const next = cur.trimEnd() + '\n\n' + bibtex.trim() + '\n'
        await this.store.writeBib(paperId, next)
        return { ok: true }
      }

      case 'compile': {
        const paperId = requireString(args, 'paperId')
        // Lazy import to avoid pulling the compiler module on cold start.
        const { LatexCompiler } = await import('../latex/compiler')
        const compiler = new LatexCompiler(this.mainWindow)
        try {
          return await compiler.build(paperId, this.store)
        } finally {
          compiler.destroy()
        }
      }

      case 'search': {
        const query = requireString(args, 'query')
        const regex = !!args.regex
        const paperId = typeof args.paperId === 'string' ? args.paperId : null
        if (paperId) {
          const tex = await this.store.readTex(paperId)
          return { paperId, hits: searchText(tex, query, regex) }
        }
        const papers = await this.store.listPapers()
        const out: { paperId: string; title: string; hits: ReturnType<typeof searchText> }[] = []
        for (const p of papers) {
          const tex = await this.store.readTex(p.id)
          const hits = searchText(tex, query, regex)
          if (hits.length > 0) out.push({ paperId: p.id, title: p.title, hits })
        }
        return out
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }
}

function requireString(args: Record<string, unknown>, name: string): string {
  const v = args[name]
  if (typeof v !== 'string') throw new Error(`Missing or invalid '${name}' (expected string)`)
  return v
}

function requireInt(args: Record<string, unknown>, name: string): number {
  const v = args[name]
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(`Missing or invalid '${name}' (expected integer)`)
  }
  return v
}
