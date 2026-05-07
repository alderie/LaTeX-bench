import { spawn, type ChildProcess } from 'child_process'
import { copyFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import type { BuildError, BuildResult, PaperSettings } from '../../shared/types'
import type { PaperStoreManager } from '../store'
import { parseLatexLog } from './log-parser'

// Spawns user-installed pdflatex / xelatex / latexmk. Streams progress lines
// to the renderer; on success copies the PDF to <paperDir>/out/main.pdf.

export class LatexCompiler {
  private running = new Map<string, ChildProcess>()

  constructor(private mainWindow: BrowserWindow) {}

  async build(paperId: string, store: PaperStoreManager): Promise<BuildResult> {
    if (this.running.has(paperId)) {
      // Cancel the previous run; latexmk is fine to kill mid-pass.
      this.cancel(paperId)
    }

    const settings: PaperSettings = await store.getSettings(paperId)
    const paperDir = store.paperDir(paperId)
    const buildDir = join(paperDir, '.build')
    const outDir = join(paperDir, 'out')

    const start = Date.now()
    const { cmd, args } = buildCommand(settings.engine, settings.mainFile)

    return new Promise<BuildResult>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: paperDir,
        windowsHide: true,
        shell: false
      })
      this.running.set(paperId, child)

      let stdout = ''
      let stderr = ''
      const send = (line: string) => {
        try {
          this.mainWindow.webContents.send('latex:build-progress', { paperId, line })
        } catch {
          // window closed
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stdout += text
        for (const line of text.split(/\r?\n/)) if (line) send(line)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text
        for (const line of text.split(/\r?\n/)) if (line) send(line)
      })

      child.on('error', (err) => {
        this.running.delete(paperId)
        const result: BuildResult = {
          success: false,
          paperId,
          pdfPath: null,
          log: stderr || err.message,
          errors: [
            {
              message: `Failed to spawn '${cmd}': ${err.message}. Is TeX Live / MiKTeX installed and on PATH?`,
              severity: 'error'
            }
          ],
          durationMs: Date.now() - start
        }
        try {
          this.mainWindow.webContents.send('latex:build-complete', result)
        } catch {
          // window closed
        }
        resolve(result)
      })

      child.on('close', async (code) => {
        this.running.delete(paperId)

        // latexmk / pdflatex usually leave a .log file even on error — prefer
        // its parsed output to the raw stdout.
        const logPath = join(buildDir, baseName(settings.mainFile) + '.log')
        let logText = stdout + '\n' + stderr
        if (existsSync(logPath)) {
          try {
            logText = await readFile(logPath, 'utf-8')
          } catch {
            // fall back to streamed output
          }
        }

        const errors: BuildError[] = parseLatexLog(logText)
        const builtPdf = join(buildDir, baseName(settings.mainFile) + '.pdf')
        const finalPdf = join(outDir, 'main.pdf')

        let success = false
        if (code === 0 && existsSync(builtPdf)) {
          try {
            await copyFile(builtPdf, finalPdf)
            success = true
          } catch (err) {
            errors.push({
              message: `Compiled PDF copy failed: ${(err as Error).message}`,
              severity: 'error'
            })
          }
        }

        const result: BuildResult = {
          success,
          paperId,
          pdfPath: success ? finalPdf : null,
          log: logText,
          errors,
          durationMs: Date.now() - start
        }
        try {
          this.mainWindow.webContents.send('latex:build-complete', result)
        } catch {
          // window closed
        }
        resolve(result)
      })
    })
  }

  cancel(paperId: string): void {
    const child = this.running.get(paperId)
    if (!child) return
    try {
      child.kill()
    } catch {
      // already dead
    }
    this.running.delete(paperId)
  }

  destroy(): void {
    for (const child of this.running.values()) {
      try {
        child.kill()
      } catch {
        // ignore
      }
    }
    this.running.clear()
  }
}

function baseName(mainFile: string): string {
  return mainFile.replace(/\.tex$/i, '')
}

function buildCommand(
  engine: PaperSettings['engine'],
  mainFile: string
): { cmd: string; args: string[] } {
  const base = baseName(mainFile)
  if (engine === 'latexmk') {
    return {
      cmd: 'latexmk',
      args: [
        '-pdf',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-synctex=1',
        '-file-line-error',
        '-outdir=.build',
        mainFile
      ]
    }
  }
  // Single-pass fallback. For real builds users should install latexmk —
  // citations / TOC may need a second pass we don't run here.
  return {
    cmd: engine,
    args: [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-synctex=1',
      '-file-line-error',
      '-output-directory=.build',
      `-jobname=${base}`,
      mainFile
    ]
  }
}
