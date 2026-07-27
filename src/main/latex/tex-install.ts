import { spawn, type ChildProcess } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { BrowserWindow } from 'electron'
import type { TexInstallProgress, TexInstallState } from '../../shared/types'
import { managedBinDir, managedTexDir, managedTexSize, managedTexVersion } from './managed-tex'
import { phaseProgress, progressFromLine } from './tex-progress'
import {
  bundledPerlPath,
  extractSpec,
  installTlSpec,
  installerArchiveName,
  powershellUnzipSpec,
  spawnSpec,
  texPath,
  tlmgrName,
  type SpawnSpec
} from './tex-commands'

// Installing TeX, without asking anyone to install TeX.
//
// The alternative this replaces is a paragraph in a README telling a person
// who wants to write a paper to go and fetch a four-gigabyte distribution
// first. What happens instead: the app downloads TeX Live's own network
// installer and points it at a directory the app owns, in portable mode, so
// that nothing lands in /usr/local, nothing is added to anyone's PATH, no
// step needs administrator rights, and uninstalling is deleting a folder.
//
// Everything here is TeX Live's officially supported mechanism — a profile
// file and `tlmgr` — rather than a repackaged bundle, so it stays correct as
// TeX Live moves.

/**
 * Where to fetch from.
 *
 * `mirror.ctan.org` is the redirector CTAN maintains and is the right first
 * choice, but it round-robins to whichever mirror is nearest and any single
 * one of those can be down, slow, or mid-sync. The named mirrors are the
 * fallbacks, on three continents.
 */
const REPOSITORIES = [
  'https://mirror.ctan.org/systems/texlive/tlnet',
  'https://ftp.tu-chemnitz.de/pub/tex/systems/texlive/tlnet',
  'https://mirrors.rit.edu/CTAN/systems/texlive/tlnet',
  'https://ctan.math.illinois.edu/systems/texlive/tlnet'
]

/**
 * What gets installed beyond the base scheme.
 *
 * `scheme-basic` is LaTeX and nothing else, which compiles almost no real
 * paper. This is the set a paper in this editor actually reaches for: the
 * default engine, the packages the starter document loads, and the ones
 * every template in the wild assumes are present. Roughly 250MB installed —
 * a fraction of a full TeX Live, and enough that the first compile works.
 */
const EXTRA_PACKAGES = [
  'latexmk',
  'hyperref',
  'amsfonts',
  'booktabs',
  'caption',
  'natbib',
  'microtype',
  'xcolor',
  'geometry',
  'enumitem',
  // No `subcaption` — it ships inside `caption`, and asking tlmgr for it by
  // name fails the whole install step.
  'float',
  'wrapfig',
  'listings',
  'algorithms',
  'algorithmicx',
  'cleveref',
  'multirow',
  'ulem',
  'setspace',
  'titlesec',
  'lipsum',
  // The modern bibliography stack. The editor reads `references.bib` and
  // completes from it, so the tools that consume one belong in the base
  // install rather than being a thing you discover you're missing.
  'biblatex',
  'biber'
]

/**
 * The tree layout, as a TeX Live install profile.
 *
 * Every `TEXMF*` is named explicitly and put inside `TEXDIR`. Portable mode
 * alone does not do this: it leaves the distribution's `/usr/local/texlive`
 * defaults in the generated `texmf.cnf`, and the first `fmtutil` run then
 * tries to write formats into a system directory that doesn't exist and
 * fails the install.
 */
export function installProfile(texDir: string): string {
  // Forward slashes throughout: kpathsea reads them on every platform, and
  // a backslash in a profile or a texmf.cnf is an escape character — so a
  // literal `C:\texlive\texmf-var` would carry a tab into the path.
  const tree = (...parts: string[]): string => texPath(join(texDir, ...parts))
  return [
    'selected_scheme scheme-basic',
    `TEXDIR ${texPath(texDir)}`,
    `TEXMFLOCAL ${tree('texmf-local')}`,
    `TEXMFSYSVAR ${tree('texmf-var')}`,
    `TEXMFSYSCONFIG ${tree('texmf-config')}`,
    `TEXMFVAR ${tree('texmf-var')}`,
    `TEXMFCONFIG ${tree('texmf-config')}`,
    `TEXMFHOME ${tree('texmf-home')}`,
    // Don't touch the user's shell profile, don't pin the repository we
    // happened to install from, don't keep package backups we'd never use.
    'instopt_adjustpath 0',
    'instopt_adjustrepo 1',
    'instopt_portable 1',
    'instopt_letter 0',
    'instopt_write18_restricted 1',
    'tlpdbopt_autobackup 0',
    'tlpdbopt_install_docfiles 0',
    'tlpdbopt_install_srcfiles 0',
    ''
  ].join('\n')
}

/**
 * A `texmf.cnf` that resolves every tree relative to the running binary.
 *
 * Written over the one the installer generates, which hardcodes the absolute
 * paths from the profile. `$SELFAUTOPARENT` is kpathsea's "the directory
 * above the binary I am", so the installation keeps working if the folder
 * moves — which it does: this lives under a per-user application data
 * directory, and those get migrated, restored from backups, and copied
 * between machines.
 */
const RELOCATABLE_TEXMF_CNF = [
  '% Written by the editor. Every tree resolves relative to the binary that',
  '% is running, so this installation can be moved or copied wholesale.',
  'TEXMFLOCAL = $SELFAUTOPARENT/texmf-local',
  'TEXMFSYSVAR = $SELFAUTOPARENT/texmf-var',
  'TEXMFSYSCONFIG = $SELFAUTOPARENT/texmf-config',
  'TEXMFVAR = $SELFAUTOPARENT/texmf-var',
  'TEXMFCONFIG = $SELFAUTOPARENT/texmf-config',
  'TEXMFHOME = $SELFAUTOPARENT/texmf-home',
  ''
].join('\n')

export class TexInstaller {
  private running: ChildProcess | null = null
  private cancelled = false
  private installing = false
  private progress: TexInstallProgress = { phase: 'idle', percent: 0, message: '' }

  constructor(
    private rootDir: string,
    private mainWindow: BrowserWindow
  ) {}

  // ── State ──

  async getState(systemTexAvailable: boolean): Promise<TexInstallState> {
    const binDir = managedBinDir(this.rootDir)
    return {
      installed: binDir !== null,
      installing: this.installing,
      directory: managedTexDir(this.rootDir),
      binDir,
      version: managedTexVersion(this.rootDir),
      sizeBytes: binDir ? managedTexSize(this.rootDir) : 0,
      progress: this.progress,
      systemTexAvailable
    }
  }

  private emit(progress: TexInstallProgress): void {
    this.progress = progress
    try {
      this.mainWindow.webContents.send('tex:install-progress', progress)
    } catch {
      // window closed
    }
  }

  // ── Install ──

  async install(): Promise<TexInstallState> {
    if (this.installing) return this.getState(false)
    this.installing = true
    this.cancelled = false

    const texDir = managedTexDir(this.rootDir)
    const work = join(this.rootDir, '.tex-install')

    try {
      await rm(work, { recursive: true, force: true })
      await mkdir(work, { recursive: true })

      const repository = await this.fetchInstaller(work)
      const installerDir = await this.extractInstaller(work)
      await this.runInstallTl(work, installerDir, texDir, repository)
      await this.configureTree(texDir)
      await this.installPackages(texDir, repository)

      this.emit({ phase: 'done', percent: 100, message: 'TeX Live is ready.' })
    } catch (err) {
      const message = this.cancelled ? 'Installation cancelled.' : (err as Error).message
      // A half-finished tree is worse than none: it looks installed to
      // `managedBinDir` while missing the packages a build needs.
      await rm(texDir, { recursive: true, force: true }).catch(() => undefined)
      this.emit({
        phase: 'failed',
        percent: 0,
        message: this.cancelled ? 'Cancelled' : 'Installation failed',
        error: message
      })
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined)
      this.installing = false
      this.running = null
    }

    return this.getState(false)
  }

  /** Download the net installer, trying each mirror in turn. */
  private async fetchInstaller(work: string): Promise<string> {
    const archive = installerArchiveName(process.platform)
    const target = join(work, archive)
    const failures: string[] = []

    for (const repository of REPOSITORIES) {
      if (this.cancelled) throw new Error('cancelled')
      this.emit(phaseProgress('download', `Contacting ${hostOf(repository)}…`))
      try {
        const response = await fetch(`${repository}/${archive}`, { redirect: 'follow' })
        if (!response.ok || !response.body) {
          failures.push(`${hostOf(repository)}: HTTP ${response.status}`)
          continue
        }
        const total = Number(response.headers.get('content-length')) || 0
        let received = 0
        const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
        source.on('data', (chunk: Buffer) => {
          received += chunk.length
          this.emit(
            phaseProgress(
              'download',
              `Downloading the installer… ${Math.round(received / 1_000_000)} MB`,
              total ? received / total : 0
            )
          )
        })
        await pipeline(source, createWriteStream(target))
        return repository
      } catch (err) {
        if (this.cancelled) throw new Error('cancelled')
        failures.push(`${hostOf(repository)}: ${(err as Error).message}`)
      }
    }
    throw new Error(
      `Could not download the TeX Live installer from any mirror. ${failures.join('; ')}`
    )
  }

  private async extractInstaller(work: string): Promise<string> {
    this.emit(phaseProgress('extract', 'Unpacking the installer…'))
    const name = installerArchiveName(process.platform)

    // `tar` reads both formats and ships with macOS, every Linux, and
    // Windows 10 build 17063 onward. Note the archive is named rather than
    // pathed and tar runs inside the work directory — see `extractSpec`.
    try {
      await this.runSpec(extractSpec(name, process.platform), work, () => undefined)
    } catch (err) {
      if (process.platform !== 'win32') throw err
      // Windows without tar. PowerShell has been able to unpack a zip
      // since 5.0, which is every supported Windows.
      await this.runSpec(powershellUnzipSpec(join(work, name), work), work, () => undefined)
    }

    const entries = await readdir(work, { withFileTypes: true })
    const dir = entries.find((e) => e.isDirectory() && e.name.startsWith('install-tl-'))
    if (!dir) throw new Error('The downloaded installer did not contain an install-tl directory.')
    return join(work, dir.name)
  }

  private async runInstallTl(
    work: string,
    installerDir: string,
    texDir: string,
    repository: string
  ): Promise<void> {
    this.emit(phaseProgress('install', 'Starting the TeX Live installer…'))
    const profile = join(work, 'tex.profile')
    await writeFile(profile, installProfile(texDir), 'utf-8')

    // The Windows archive carries its own Perl; every other platform has one.
    const perl = bundledPerlPath(installerDir)
    const spec = installTlSpec(
      installerDir,
      profile,
      repository,
      process.platform,
      existsSync(perl) ? perl : null
    )

    await this.runSpec(spec, installerDir, (line) => {
      const update = progressFromLine('install', line)
      if (update) this.emit(update)
    })

    if (!managedBinDir(this.rootDir)) {
      throw new Error('The installer finished but no TeX binaries were produced.')
    }
  }

  private async configureTree(texDir: string): Promise<void> {
    this.emit(phaseProgress('configure', 'Making the installation relocatable…'))
    await writeFile(join(texDir, 'texmf.cnf'), RELOCATABLE_TEXMF_CNF, 'utf-8')
  }

  private async installPackages(texDir: string, repository: string): Promise<void> {
    // On Windows this is `tlmgr.bat`, which Node will not spawn directly —
    // `spawnSpec` routes it through the command interpreter.
    const tlmgr = join(managedBinDir(this.rootDir) ?? '', tlmgrName(process.platform))
    if (!existsSync(tlmgr)) throw new Error('tlmgr is missing from the new installation.')

    this.emit(phaseProgress('packages', 'Adding the packages a paper needs…'))
    await this.runSpec(
      spawnSpec(tlmgr, ['option', 'repository', repository], process.platform),
      texDir,
      () => undefined
    )
    await this.runSpec(
      spawnSpec(tlmgr, ['install', ...EXTRA_PACKAGES], process.platform),
      texDir,
      (line) => {
        const update = progressFromLine('packages', line)
        if (update) this.emit(update)
      }
    )
  }

  /**
   * Spawn a step and stream its output.
   *
   * `tlmgr install` exits non-zero when a package is already present, which
   * is not a failure — re-running the install over an existing tree should
   * converge rather than error. A package name that isn't in the repository
   * exits the same way and very much is one, so the two are told apart by
   * what was printed rather than by the code alone.
   */
  private runSpec(spec: SpawnSpec, cwd: string, onLine: (line: string) => void): Promise<void> {
    const { command, args } = spec
    return new Promise((resolve, reject) => {
      if (this.cancelled) return reject(new Error('cancelled'))
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: spec.windowsVerbatimArguments
      })
      this.running = child

      let tail = ''
      const consume = (chunk: Buffer): void => {
        const text = chunk.toString()
        tail = (tail + text).slice(-4000)
        for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line)
      }
      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)

      child.on('error', (err) => {
        this.running = null
        reject(
          new Error(
            command === 'perl'
              ? `Perl is required to install TeX Live and could not be started: ${err.message}`
              : `Could not run ${basename(command)}: ${err.message}`
          )
        )
      })
      child.on('close', (code) => {
        this.running = null
        if (this.cancelled) return reject(new Error('cancelled'))
        if (code === 0) return resolve()
        const unknownPackage = /not present in repository|not found neither locally nor remote/i
        if (unknownPackage.test(tail)) {
          const named = /package (\S+) not present in repository/i.exec(tail)?.[1]
          return reject(
            new Error(`TeX Live has no package named "${named ?? 'unknown'}". ${lastLine(tail)}`)
          )
        }
        // Everything already installed is a converged state, not a failure.
        if (/already present/i.test(tail)) return resolve()
        reject(new Error(`${basename(command)} exited with code ${code}. ${lastLine(tail)}`))
      })
    })
  }

  // ── Cancel / remove ──

  cancel(): void {
    if (!this.installing) return
    this.cancelled = true
    try {
      this.running?.kill()
    } catch {
      // already gone
    }
  }

  /** Delete the managed installation. The whole point of the directory. */
  async remove(): Promise<void> {
    this.cancel()
    await rm(managedTexDir(this.rootDir), { recursive: true, force: true })
    await rm(join(this.rootDir, '.tex-install'), { recursive: true, force: true }).catch(
      () => undefined
    )
    this.emit({ phase: 'idle', percent: 0, message: '' })
  }

  destroy(): void {
    this.cancel()
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function basename(command: string): string {
  return command.split(/[\\/]/).pop() ?? command
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  return lines[lines.length - 1] ?? ''
}
