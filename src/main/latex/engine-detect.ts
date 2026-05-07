import { spawn } from 'child_process'
import type { EngineInfo, PaperSettings } from '../../shared/types'

const ENGINES: { id: PaperSettings['engine']; name: string; arg: string }[] = [
  { id: 'latexmk', name: 'latexmk', arg: '--version' },
  { id: 'pdflatex', name: 'pdfLaTeX', arg: '--version' },
  { id: 'xelatex', name: 'XeLaTeX', arg: '--version' },
  { id: 'lualatex', name: 'LuaLaTeX', arg: '--version' }
]

function probe(cmd: string, arg: string): Promise<{ ok: boolean; version: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [arg], { windowsHide: true, shell: false })
    let out = ''
    let errored = false
    child.stdout?.on('data', (b) => (out += b.toString()))
    child.on('error', () => {
      errored = true
      resolve({ ok: false, version: null })
    })
    child.on('close', (code) => {
      if (errored) return
      if (code === 0) {
        const firstLine = out.split('\n')[0]?.trim() || null
        resolve({ ok: true, version: firstLine })
      } else {
        resolve({ ok: false, version: null })
      }
    })
  })
}

export async function detectEngines(): Promise<EngineInfo[]> {
  const results = await Promise.all(
    ENGINES.map(async (e) => {
      const { ok, version } = await probe(e.id, e.arg)
      return {
        id: e.id,
        name: e.name,
        available: ok,
        path: ok ? e.id : null,
        version
      } as EngineInfo
    })
  )
  return results
}
