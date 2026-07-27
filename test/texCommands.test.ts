import { describe, it, expect } from 'vitest'
import {
  bundledPerlPath,
  extractSpec,
  installTlSpec,
  installerArchiveName,
  powershellUnzipSpec,
  spawnSpec,
  texPath,
  tlmgrName
} from '../src/main/latex/tex-commands'

// The platform rules for invoking the TeX Live installer. Windows is the
// interesting one, and each case here is a way the install actually broke.

const WIN_WORK = 'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\app\\.tex-install'
const WIN_INSTALLER = `${WIN_WORK}\\install-tl-20260727`

describe('extractSpec', () => {
  it('names the archive rather than pathing it', () => {
    // The bug: `tar -xf C:\...\install-tl.zip` makes bsdtar read `C:` as a
    // remote host and fail with "Cannot connect to C: resolve failed". Only
    // a bare filename, run from the work directory, is safe to pass it.
    const spec = extractSpec('install-tl.zip', 'win32')
    expect(spec.args).toEqual(['-xf', 'install-tl.zip'])
    expect(spec.args.join(' ')).not.toContain(':')
  })

  it('is the same shape on unix', () => {
    const spec = extractSpec('install-tl-unx.tar.gz', 'linux')
    expect(spec).toEqual({ command: 'tar', args: ['-xf', 'install-tl-unx.tar.gz'] })
  })
})

describe('spawnSpec', () => {
  it('runs an ordinary executable directly', () => {
    const spec = spawnSpec('C:\\tex\\bin\\windows\\latexmk.exe', ['-pdf'], 'win32')
    expect(spec.command).toBe('C:\\tex\\bin\\windows\\latexmk.exe')
    expect(spec.args).toEqual(['-pdf'])
    expect(spec.shell).toBeUndefined()
  })

  it('routes a Windows batch file through the interpreter', () => {
    // Node refuses to spawn .bat/.cmd directly since the CVE-2024-27980
    // fix, and `tlmgr.bat` is how TeX Live ships tlmgr on Windows.
    const spec = spawnSpec('C:\\tex\\bin\\windows\\tlmgr.bat', ['install', 'latexmk'], 'win32')
    expect(spec.command.toLowerCase()).toContain('cmd')
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(spec.args[3]).toContain('"C:\\tex\\bin\\windows\\tlmgr.bat"')
    expect(spec.args[3]).toContain('install latexmk')
    expect(spec.windowsVerbatimArguments).toBe(true)
  })

  it('quotes an argument containing spaces', () => {
    const spec = spawnSpec('C:\\t\\tlmgr.bat', ['-profile', WIN_WORK + '\\tex.profile'], 'win32')
    expect(spec.args[3]).toContain(`"${WIN_WORK}\\tex.profile"`)
  })

  it('leaves a .bat alone on unix, where it is just a filename', () => {
    const spec = spawnSpec('/opt/thing.bat', ['x'], 'linux')
    expect(spec.command).toBe('/opt/thing.bat')
  })
})

describe('installTlSpec', () => {
  it('uses the system perl on unix', () => {
    const spec = installTlSpec(
      '/tmp/w/install-tl-2026',
      '/tmp/w/tex.profile',
      'https://m',
      'linux',
      null
    )
    expect(spec.command).toBe('perl')
    expect(spec.args[0]).toBe('/tmp/w/install-tl-2026/install-tl')
    expect(spec.args).toContain('-no-interaction')
    expect(spec.args).toContain('https://m')
  })

  it('prefers the Perl the Windows archive ships with', () => {
    // An .exe spawns without a shell; the install-tl-windows.bat wrapper
    // does not, and would need the cmd.exe detour for no benefit.
    const perl = bundledPerlPath(WIN_INSTALLER)
    const spec = installTlSpec(
      WIN_INSTALLER,
      `${WIN_WORK}\\tex.profile`,
      'https://m',
      'win32',
      perl
    )
    expect(spec.command).toBe(perl)
    expect(spec.command.endsWith('perl.exe')).toBe(true)
    expect(spec.windowsVerbatimArguments).toBeUndefined()
  })

  it('falls back to the batch wrapper when there is no bundled perl', () => {
    const spec = installTlSpec(WIN_INSTALLER, 'p', 'https://m', 'win32', null)
    expect(spec.command.toLowerCase()).toContain('cmd')
    expect(spec.args[3]).toContain('install-tl-windows.bat')
  })
})

describe('powershellUnzipSpec', () => {
  it('expands the archive into the work directory', () => {
    const spec = powershellUnzipSpec(`${WIN_WORK}\\install-tl.zip`, WIN_WORK)
    expect(spec.command).toBe('powershell.exe')
    expect(spec.args).toContain('-NoProfile')
    expect(spec.args.join(' ')).toContain('Expand-Archive')
    expect(spec.args.join(' ')).toContain(WIN_WORK)
  })

  it('escapes a quote in the path rather than ending the string', () => {
    const spec = powershellUnzipSpec("C:\\it's\\a.zip", 'C:\\out')
    expect(spec.args[3]).toContain("it''s")
  })
})

describe('texPath', () => {
  it('turns backslashes into forward slashes', () => {
    // A backslash is an escape character in texmf.cnf and in an install
    // profile, so `C:\texlive\texmf-var` would carry a tab into the path.
    expect(texPath('C:\\texlive\\texmf-var')).toBe('C:/texlive/texmf-var')
  })

  it('leaves a unix path alone', () => {
    expect(texPath('/home/u/.config/app/texlive')).toBe('/home/u/.config/app/texlive')
  })
})

describe('per-platform names', () => {
  it('knows what tlmgr is called', () => {
    expect(tlmgrName('win32')).toBe('tlmgr.bat')
    expect(tlmgrName('darwin')).toBe('tlmgr')
  })

  it('knows which archive to fetch', () => {
    expect(installerArchiveName('win32')).toBe('install-tl.zip')
    expect(installerArchiveName('linux')).toBe('install-tl-unx.tar.gz')
  })
})
