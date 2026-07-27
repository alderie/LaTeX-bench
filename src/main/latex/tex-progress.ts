import type { TexInstallPhase, TexInstallProgress } from '../../shared/types'

// Reading progress out of TeX Live's own output.
//
// `install-tl` and `tlmgr` both count what they're doing, in two different
// formats, and both are the only honest source of "how far along is this" —
// the download is a few hundred packages of wildly different sizes, so bytes
// and elapsed time both lie. Parsing is kept here, away from the process
// plumbing, because it is the part with edge cases worth testing.
//
//   install-tl:  Installing [069/134, time/total: 00:43/03:09]: latex [259k]
//   tlmgr:       [12/154, 00:11/15:37] install: amsfonts [3542k]

const INSTALL_TL_RE = /^Installing \[(\d+)\/(\d+),[^\]]*\]:\s*(\S+)/
const TLMGR_RE = /^\[(\d+)\/(\d+),[^\]]*\]\s*install:\s*(\S+)/

export interface PackageStep {
  done: number
  total: number
  packageName: string
}

/** The package counter on a line of TeX Live output, if there is one. */
export function parsePackageStep(line: string): PackageStep | null {
  const match = INSTALL_TL_RE.exec(line) ?? TLMGR_RE.exec(line)
  if (!match) return null
  const done = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null
  return { done, total, packageName: match[3] }
}

/**
 * How much of the whole job each phase is worth.
 *
 * Hand-weighted from real runs rather than split evenly: fetching the 5MB
 * installer is seconds and installing the base scheme is minutes, and a bar
 * that spends half its travel on the first two seconds is a bar that then
 * appears to hang.
 */
const PHASE_SPAN: Record<TexInstallPhase, [number, number]> = {
  idle: [0, 0],
  download: [0, 6],
  extract: [6, 9],
  install: [9, 72],
  configure: [72, 75],
  packages: [75, 99],
  done: [100, 100],
  failed: [0, 0]
}

/** Overall percentage for a phase that is `fraction` of the way through. */
export function overallPercent(phase: TexInstallPhase, fraction: number): number {
  const [from, to] = PHASE_SPAN[phase]
  const clamped = Math.min(1, Math.max(0, fraction))
  return Math.round(from + (to - from) * clamped)
}

/** A progress record for a phase with no measurable sub-steps. */
export function phaseProgress(
  phase: TexInstallPhase,
  message: string,
  fraction = 0
): TexInstallProgress {
  return { phase, percent: overallPercent(phase, fraction), message }
}

/**
 * Turn one line of TeX Live output into a progress update.
 *
 * Returns null for the great majority of lines, which are banners, mirror
 * URLs, and post-action chatter — the caller keeps the last update rather
 * than flickering back to an indeterminate state.
 */
export function progressFromLine(
  phase: 'install' | 'packages',
  line: string
): TexInstallProgress | null {
  const step = parsePackageStep(line)
  if (!step) return null
  return {
    phase,
    percent: overallPercent(phase, step.done / step.total),
    message: `${step.packageName}  (${step.done} of ${step.total})`
  }
}

/** Bytes as something a person reads. Used for the download and the size. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / 1_000_000
  if (mb < 1) return `${Math.round(bytes / 1000)} kB`
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1000).toFixed(2)} GB`
}
