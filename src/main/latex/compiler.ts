import { spawn, type ChildProcess } from 'child_process'
import { copyFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import type { BuildError, BuildResult, PaperSettings } from '../../shared/types'
import type { PaperStoreManager } from '../store'
import { parseLatexLog } from './log-parser'
import { missingPackagesFromLog } from './tex-packages'
import { managedExecutable, texEnv } from './managed-tex'

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

    // Prefer the TeX the app installed for itself. Spawning the absolute
    // path is not enough on its own — `latexmk` shells out to `pdflatex` and
    // `biber` by name — so the child's PATH leads with the managed `bin` too.
    const managed = managedExecutable(store.rootDir, cmd)
    const command = managed ?? cmd
    const env = texEnv(store.rootDir)

    return new Promise<BuildResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: paperDir,
        windowsHide: true,
        shell: false,
        env
      })
      this.running.set(paperId, child)

      let stdout = ''
      let stderr = ''
      // A binary that isn't on PATH makes Node emit *both* `error` and
      // `close`. The `error` handler is the one that knows what went wrong
      // ("is TeX Live installed?"); the `close` that follows it finds no log
      // file, parses nothing out of an empty string, and used to overwrite
      // that answer with a bare failure carrying no errors at all. First
      // result wins.
      let settled = false
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
        if (settled) return
        settled = true
        this.running.delete(paperId)
        const result: BuildResult = {
          success: false,
          paperId,
          pdfPath: null,
          log: stderr || err.message,
          errors: [
            {
              // The install button in the build panel keys off this being
              // the reason a build failed, so the wording says what is
              // missing rather than only that something went wrong.
              message: `No LaTeX engine found: '${cmd}' could not be started (${err.message}). Install TeX from the build panel, or install TeX Live / MiKTeX yourself and put it on PATH.`,
              severity: 'error'
            }
          ],
          // Nothing ran, so nothing can be missing yet — the engine itself is.
          missingPackages: [],
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
        if (settled) return
        settled = true
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

        // A failure the log parser found nothing in is the worst possible
        // report: the panel says the build failed and then has nothing to
        // show for it. Say what we do know — the exit code, and where the
        // full output is — rather than an empty list.
        if (!success && errors.length === 0) {
          errors.push({
            message:
              `${cmd} exited with code ${code ?? 'unknown'} and produced no PDF. ` +
              'Nothing in the log matched a known error pattern — see the Log tab for the full output.',
            severity: 'error'
          })
        }

        const result: BuildResult = {
          success,
          paperId,
          pdfPath: success ? finalPdf : null,
          log: logText,
          errors,
          // Only when the build failed: a successful run can still mention a
          // file it didn't find on a first pass and then resolved.
          missingPackages: success ? [] : missingPackagesFromLog(logText),
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
