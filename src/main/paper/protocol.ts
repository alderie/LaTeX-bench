import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { join, normalize, sep } from 'path'
import type { PaperStoreManager } from '../store'

// Custom `paper://` protocol — serves files from inside a paper's folder
// without exposing arbitrary userData paths to the renderer.
//
//   paper://<paperId>/assets/<file>
//   paper://<paperId>/out/main.pdf
//
// Requested paths are sandboxed to the paper's dir; any traversal attempt
// (`..`) resolves outside and is rejected.

export function registerPaperProtocol(store: PaperStoreManager): void {
  protocol.handle('paper', async (request) => {
    try {
      const url = new URL(request.url)
      const paperId = url.hostname
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!paperId || !rel) return new Response('Bad request', { status: 400 })

      const paperDir = store.paperDir(paperId)
      const target = normalize(join(paperDir, rel))

      // Reject paths that escape the paper dir.
      if (!target.startsWith(paperDir + sep) && target !== paperDir) {
        return new Response('Forbidden', { status: 403 })
      }

      return net.fetch(pathToFileURL(target).toString())
    } catch (err) {
      return new Response(`Error: ${(err as Error).message}`, { status: 500 })
    }
  })
}
