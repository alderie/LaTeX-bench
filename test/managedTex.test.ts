import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  managedBinDir,
  managedExecutable,
  managedTexDir,
  managedTexSize,
  managedTexVersion,
  texEnv
} from '../src/main/latex/managed-tex'

// Finding the TeX the app installed for itself. Everything here runs against
// a real directory tree rather than a mocked `fs`, because the thing being
// tested *is* the shape of the tree TeX Live produces.

let root: string

function makeInstall(binName = 'x86_64-linux'): string {
  const bin = join(managedTexDir(root), 'bin', binName)
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'kpsewhich'), '#!/bin/sh\n')
  writeFileSync(join(bin, 'latexmk'), '#!/bin/sh\n')
  writeFileSync(join(bin, 'pdflatex'), '#!/bin/sh\n')
  return bin
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'corbato-tex-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('managedTexDir', () => {
  it('is one directory inside the app’s own folder', () => {
    expect(managedTexDir('/data/app')).toBe(join('/data/app', 'texlive'))
  })
})

describe('managedBinDir', () => {
  it('is null when nothing is installed', () => {
    expect(managedBinDir(root)).toBeNull()
  })

  it('finds the platform-named directory without knowing its name', () => {
    const bin = makeInstall('universal-darwin')
    expect(managedBinDir(root)).toBe(bin)
  })

  it('ignores a bin directory with no TeX binaries in it', () => {
    // A half-deleted or interrupted install leaves the shell of a tree.
    mkdirSync(join(managedTexDir(root), 'bin', 'x86_64-linux'), { recursive: true })
    expect(managedBinDir(root)).toBeNull()
  })
})

describe('managedExecutable', () => {
  it('resolves a binary to an absolute path', () => {
    const bin = makeInstall()
    expect(managedExecutable(root, 'latexmk')).toBe(join(bin, 'latexmk'))
  })

  it('is null for a binary the installation does not have', () => {
    makeInstall()
    expect(managedExecutable(root, 'xelatex')).toBeNull()
  })

  it('is null when there is no installation at all', () => {
    expect(managedExecutable(root, 'latexmk')).toBeNull()
  })
})

describe('texEnv', () => {
  it('puts the managed bin ahead of the existing PATH', () => {
    // latexmk shells out to pdflatex by name, so the child has to find the
    // same installation the parent was started from.
    const bin = makeInstall()
    const env = texEnv(root, { PATH: '/usr/bin:/bin' })
    expect(env.PATH).toBe(`${bin}:/usr/bin:/bin`)
  })

  it('keeps the user’s own PATH rather than replacing it', () => {
    makeInstall()
    expect(texEnv(root, { PATH: '/opt/mytex/bin' }).PATH).toContain('/opt/mytex/bin')
  })

  it('is the environment unchanged when nothing is installed', () => {
    const base = { PATH: '/usr/bin' }
    expect(texEnv(root, base)).toBe(base)
  })

  it('copes with an empty PATH', () => {
    const bin = makeInstall()
    expect(texEnv(root, {}).PATH).toBe(`${bin}:`)
  })
})

describe('managedTexSize', () => {
  it('is zero when nothing is installed', () => {
    expect(managedTexSize(root)).toBe(0)
  })

  it('adds up the files it finds', () => {
    makeInstall()
    writeFileSync(join(managedTexDir(root), 'payload.bin'), Buffer.alloc(4096))
    expect(managedTexSize(root)).toBeGreaterThanOrEqual(4096)
  })

  it('does not count a symlink’s target twice', () => {
    // TeX Live's bin directory is mostly links into texmf-dist/scripts;
    // following them would roughly double the reported size.
    makeInstall()
    const dir = managedTexDir(root)
    writeFileSync(join(dir, 'real.bin'), Buffer.alloc(10_000))
    symlinkSync(join(dir, 'real.bin'), join(dir, 'link.bin'))
    expect(managedTexSize(root)).toBeLessThan(20_000)
  })
})

describe('managedTexVersion', () => {
  it('reads the release file TeX Live actually writes', () => {
    // Verbatim first line from a real install. Note it does *not* contain
    // the string "TeX Live 2026", which is what a naive match looked for.
    makeInstall()
    writeFileSync(
      join(managedTexDir(root), 'release-texlive.txt'),
      'TeX Live (https://tug.org/texlive) version 2026\n\nThis file is public domain.\n'
    )
    expect(managedTexVersion(root)).toBe('TeX Live 2026')
  })

  it('is null when the first line carries no year', () => {
    makeInstall()
    writeFileSync(join(managedTexDir(root), 'release-texlive.txt'), 'unreleased build\n')
    expect(managedTexVersion(root)).toBeNull()
  })

  it('is null when the file is absent', () => {
    makeInstall()
    expect(managedTexVersion(root)).toBeNull()
  })
})
