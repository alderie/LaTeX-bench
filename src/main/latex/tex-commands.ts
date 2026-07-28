import { join } from 'path'

// How to invoke each step of the install, per platform.
//
// Pure, and separate from the process plumbing, because the Windows rules
// here are the kind you only find by running it on Windows and are then
// worth pinning down in a test rather than rediscovering.

export type Platform = 'win32' | 'darwin' | 'linux' | string

export interface SpawnSpec {
  command: string
  args: string[]
  /** Set when the command can only be run through a shell. */
  shell?: boolean
  /** Pass argv through to Windows untouched; see `batSpec`. */
  windowsVerbatimArguments?: boolean
}

/**
 * Run a program, routing Windows batch files through the interpreter.
 *
 * Node refuses to spawn `.bat`/`.cmd` directly — it has since the fix for
 * CVE-2024-27980 — so `tlmgr.bat`, which is how TeX Live ships tlmgr on
 * Windows, cannot simply be executed. Going through `cmd.exe /c` with
 * verbatim arguments is the documented way, and quoting the file itself
 * keeps it working under the spaces that `C:\Users\Ada Lovelace\…` has.
 */
export function spawnSpec(file: string, args: string[], platform: Platform): SpawnSpec {
  if (platform !== 'win32' || !/\.(bat|cmd)$/i.test(file)) {
    return { command: file, args }
  }
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${file}" ${args.map(quoteForCmd).join(' ')}`],
    windowsVerbatimArguments: true
  }
}

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * Unpack the downloaded installer.
 *
 * The archive is named, not pathed, and `tar` is run *inside* the work
 * directory. That is the whole fix for a Windows install failing with
 * "Cannot connect to C: resolve failed": tar reads `host:path` as a remote
 * archive, so an absolute Windows path makes it try to reach a machine
 * called `C` over the network. GNU tar has `--force-local` for this; the
 * bsdtar that Windows ships does not, and no path with a drive letter is
 * safe to hand it.
 */
export function extractSpec(archiveName: string, platform: Platform): SpawnSpec {
  return spawnSpec('tar', ['-xf', archiveName], platform)
}

/**
 * Unpack a zip with PowerShell, for Windows without `tar`.
 *
 * `tar.exe` has been in Windows since 10 build 17063, but a machine older
 * than that — or one with a trimmed System32 — would otherwise get a bare
 * "could not run tar".
 */
export function powershellUnzipSpec(archivePath: string, destination: string): SpawnSpec {
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${escapeForPowerShell(archivePath)}' ` +
        `-DestinationPath '${escapeForPowerShell(destination)}' -Force`
    ]
  }
}

function escapeForPowerShell(value: string): string {
  // Single-quoted PowerShell strings take a doubled quote as an escape and
  // interpolate nothing else, so this is the whole of it.
  return value.replace(/'/g, "''")
}

/**
 * Run the TeX Live installer.
 *
 * On Windows the archive carries its own Perl, and using it beats the
 * `install-tl-windows.bat` wrapper: the wrapper is a batch file, which Node
 * will not spawn directly, and `perl.exe` is an executable that takes its
 * arguments without a shell in between. The wrapper stays as the fallback
 * for an archive laid out differently than expected.
 */
export function installTlSpec(
  installerDir: string,
  profilePath: string,
  repository: string,
  platform: Platform,
  bundledPerl: string | null
): SpawnSpec {
  const args = ['-profile', profilePath, '-no-interaction', '-repository', repository]
  if (platform !== 'win32') {
    return { command: 'perl', args: [join(installerDir, 'install-tl'), ...args] }
  }
  if (bundledPerl) {
    return { command: bundledPerl, args: [join(installerDir, 'install-tl'), ...args] }
  }
  return spawnSpec(join(installerDir, 'install-tl-windows.bat'), args, platform)
}

/** Where the Windows installer archive keeps the Perl it ships with. */
export function bundledPerlPath(installerDir: string): string {
  return join(installerDir, 'tlpkg', 'tlperl', 'bin', 'perl.exe')
}

/** The name `tlmgr` goes by on this platform. */
export function tlmgrName(platform: Platform): string {
  return platform === 'win32' ? 'tlmgr.bat' : 'tlmgr'
}

/** The installer archive's filename on this platform. */
export function installerArchiveName(platform: Platform): string {
  return platform === 'win32' ? 'install-tl.zip' : 'install-tl-unx.tar.gz'
}

/**
 * A path as TeX Live's config files want it.
 *
 * kpathsea reads forward slashes on every platform, and a backslash in a
 * `texmf.cnf` or an install profile is an escape character — so a Windows
 * path written literally turns `C:\texlive\texmf-var` into something with a
 * tab in it.
 */
export function texPath(path: string): string {
  return path.replace(/\\/g, '/')
}
