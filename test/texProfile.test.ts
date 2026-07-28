import { describe, it, expect } from 'vitest'
import { installProfile } from '../src/main/latex/tex-install'

// The install profile is what keeps every TeX tree inside the folder the
// app owns. Getting it wrong does not fail loudly — it fails three steps
// later, when fmtutil tries to write formats into /usr/local.

describe('installProfile', () => {
  const profile = installProfile('/data/app/texlive')
  const lines = profile.split('\n')
  const value = (key: string): string | undefined =>
    lines.find((l) => l.startsWith(key + ' '))?.slice(key.length + 1)

  it('puts every TEXMF tree inside TEXDIR', () => {
    // Portable mode alone does not do this: it leaves the distribution's
    // /usr/local/texlive defaults in the generated texmf.cnf.
    for (const key of [
      'TEXMFLOCAL',
      'TEXMFSYSVAR',
      'TEXMFSYSCONFIG',
      'TEXMFVAR',
      'TEXMFCONFIG',
      'TEXMFHOME'
    ]) {
      expect(value(key), key).toBeDefined()
      expect(value(key), key).toContain('/data/app/texlive/')
    }
  })

  it('names no system directory anywhere', () => {
    expect(profile).not.toContain('/usr/local')
  })

  it('installs the base scheme, portable, without touching the user', () => {
    expect(value('selected_scheme')).toBe('scheme-basic')
    expect(value('instopt_portable')).toBe('1')
    // Editing the user's shell profile is exactly what "app managed" rules out.
    expect(value('instopt_adjustpath')).toBe('0')
  })

  it('skips documentation and sources, which are most of a TeX Live', () => {
    expect(value('tlpdbopt_install_docfiles')).toBe('0')
    expect(value('tlpdbopt_install_srcfiles')).toBe('0')
  })

  it('writes Windows paths with forward slashes', () => {
    // A backslash is an escape character here, so `C:\texlive\texmf-var`
    // would put a tab in the middle of the path.
    const win = installProfile('C:\\Users\\Ada\\AppData\\Roaming\\app\\texlive')
    expect(win).not.toContain('\\')
    expect(win).toContain('TEXDIR C:/Users/Ada/AppData/Roaming/app/texlive')
  })

  it('ends with a newline, as a config file should', () => {
    expect(profile.endsWith('\n')).toBe(true)
  })
})
