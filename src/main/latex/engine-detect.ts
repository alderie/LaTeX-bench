import { spawn } from 'child_process'
import type { EngineInfo, PaperSettings } from '../../shared/types'
import { managedExecutable, texEnv } from './managed-tex'

const ENGINES: { id: PaperSettings['engine']; name: string; arg: string }[] = [
  { id: 'latexmk', name: 'latexmk', arg: '--version' },
  { id: 'pdflatex', name: 'pdfLaTeX', arg: '--version' },
  { id: 'xelatex', name: 'XeLaTeX', arg: '--version' },
  { id: 'lualatex', name: 'LuaLaTeX', arg: '--version' }
]

function probe(
  cmd: string,
  arg: string,
  env?: NodeJS.ProcessEnv
): Promise<{ ok: boolean; version: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [arg], { windowsHide: true, shell: false, env })
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

/**
 * Which engines can be run, managed installation first.
 *
 * `rootDir` is the app's own data directory; passing it lets the probe see a
 * TeX the app installed for itself, which is on nobody's PATH by design.
 * Omitting it asks only "is there a system TeX", which is the question the
 * install prompt needs answered.
 */
export async function detectEngines(rootDir?: string): Promise<EngineInfo[]> {
  const env = rootDir ? texEnv(rootDir) : undefined
  return Promise.all(
    ENGINES.map(async (e) => {
      const managed = rootDir ? managedExecutable(rootDir, e.id) : null
      const { ok, version } = await probe(managed ?? e.id, e.arg, env)
      return {
        id: e.id,
        name: e.name,
        available: ok,
        path: ok ? (managed ?? e.id) : null,
        version
      } as EngineInfo
    })
  )
}

/** True when a usable LaTeX exists on the system PATH, ignoring ours. */
export async function hasSystemTex(): Promise<boolean> {
  const results = await Promise.all(ENGINES.map((e) => probe(e.id, e.arg)))
  return results.some((r) => r.ok)
}
