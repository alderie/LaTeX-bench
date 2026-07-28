import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'fs'
import { join } from 'path'

// Where the app's own TeX lives, and how everything else finds it.
//
// One directory, inside the folder the app already owns. Nothing is written
// to `/usr/local`, nothing is added to the user's PATH, and no installer
// runs with elevated rights — which is what makes "remove it" a matter of
// deleting a folder rather than a support question.

/** The managed installation's root, given the app's own data directory. */
export function managedTexDir(rootDir: string): string {
  return join(rootDir, 'texlive')
}

/**
 * The `bin` directory holding the executables, or null if not installed.
 *
 * TeX Live puts its binaries under a platform-named subdirectory
 * (`bin/x86_64-linux`, `bin/universal-darwin`, `bin/windows`). Rather than
 * predicting the name — which varies by platform, architecture, and TeX Live
 * release — we read whichever single directory is there.
 */
export function managedBinDir(rootDir: string): string | null {
  const bin = join(managedTexDir(rootDir), 'bin')
  if (!existsSync(bin)) return null
  try {
    for (const entry of readdirSync(bin, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(bin, entry.name)
      // `kpsewhich` is in every TeX Live binary set and is the cheapest
      // proof that this directory is a real one and not a leftover.
      if (
        existsSync(join(candidate, 'kpsewhich')) ||
        existsSync(join(candidate, 'kpsewhich.exe'))
      ) {
        return candidate
      }
    }
  } catch {
    return null
  }
  return null
}

/** Absolute path to a managed executable, or null when there is no install. */
export function managedExecutable(rootDir: string, name: string): string | null {
  const bin = managedBinDir(rootDir)
  if (!bin) return null
  for (const candidate of [join(bin, name), join(bin, `${name}.exe`), join(bin, `${name}.bat`)]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * An environment in which the managed TeX comes first.
 *
 * `latexmk` shells out to `pdflatex` and `biber` by name, so putting the
 * absolute path of the one binary we spawn is not enough — its children have
 * to resolve to the same installation. Prepending rather than replacing, so
 * a user who has their own TeX and their own helper scripts keeps them.
 */
export function texEnv(rootDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const bin = managedBinDir(rootDir)
  if (!bin) return base
  const separator = process.platform === 'win32' ? ';' : ':'
  // Windows environment variables are case-insensitive but the object here
  // is not, so find the key as it actually appears.
  const pathKey = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  return {
    ...base,
    [pathKey]: bin + separator + (base[pathKey] ?? '')
  }
}

/** Recursive size of the managed installation, in bytes. 0 when absent. */
export function managedTexSize(rootDir: string): number {
  const dir = managedTexDir(rootDir)
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = (path: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(path, entry.name)
      // Symlinks are not followed: TeX Live's `bin` is largely links into
      // `texmf-dist/scripts`, and counting both would roughly double it.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        try {
          total += statSync(full).size
        } catch {
          // raced with a delete; it contributes nothing
        }
      }
    }
  }
  walk(dir)
  return total
}

/**
 * The release of a managed install, e.g. "TeX Live 2026".
 *
 * The file this reads does not contain that string. Its first line is
 * `TeX Live (https://tug.org/texlive) version 2026`, so the year is pulled
 * out and the label rebuilt rather than matched whole.
 */
export function managedTexVersion(rootDir: string): string | null {
  const path = join(managedTexDir(rootDir), 'release-texlive.txt')
  if (!existsSync(path)) return null
  try {
    const first = readFileSync(path, 'utf-8').split('\n')[0] ?? ''
    const year = /(\d{4})/.exec(first)?.[1]
    return year ? `TeX Live ${year}` : null
  } catch {
    return null
  }
}
