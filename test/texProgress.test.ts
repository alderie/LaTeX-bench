import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  overallPercent,
  parsePackageStep,
  phaseProgress,
  progressFromLine
} from '../src/main/latex/tex-progress'

// Reading progress out of TeX Live's own output. Both formats below are
// copied from real runs — install-tl and tlmgr count differently.

describe('parsePackageStep', () => {
  it('reads install-tl’s counter', () => {
    const step = parsePackageStep('Installing [069/134, time/total: 00:43/03:09]: latex [259k]')
    expect(step).toEqual({ done: 69, total: 134, packageName: 'latex' })
  })

  it('reads install-tl’s first line, before it can estimate a time', () => {
    const step = parsePackageStep('Installing [1/4, time/total: ??:??/??:??]: hyphen-base [23k]')
    expect(step).toEqual({ done: 1, total: 4, packageName: 'hyphen-base' })
  })

  it('reads tlmgr’s counter', () => {
    const step = parsePackageStep('[12/154, 00:11/15:37] install: amsfonts [3542k]')
    expect(step).toEqual({ done: 12, total: 154, packageName: 'amsfonts' })
  })

  it('ignores the banners and chatter around them', () => {
    for (const line of [
      'Loading https://mirror.ctan.org/systems/texlive/tlnet/tlpkg/texlive.tlpdb',
      'running mktexlsr ...',
      'tlmgr install: package already present: amsfonts',
      'Welcome to TeX Live!',
      ''
    ]) {
      expect(parsePackageStep(line)).toBeNull()
    }
  })

  it('rejects a counter with a zero total rather than dividing by it', () => {
    expect(parsePackageStep('[3/0, 00:01/00:02] install: whatever [1k]')).toBeNull()
  })
})

describe('overallPercent', () => {
  it('maps a phase’s progress into the whole job', () => {
    // The install phase spans 9–72%, so halfway through it is ~40% overall.
    expect(overallPercent('install', 0)).toBe(9)
    expect(overallPercent('install', 1)).toBe(72)
    expect(overallPercent('install', 0.5)).toBe(41)
  })

  it('never runs backwards across the phases in order', () => {
    const sequence = [
      overallPercent('download', 1),
      overallPercent('extract', 1),
      overallPercent('install', 1),
      overallPercent('configure', 1),
      overallPercent('packages', 1),
      overallPercent('done', 1)
    ]
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b))
  })

  it('clamps a fraction outside 0–1', () => {
    expect(overallPercent('packages', -5)).toBe(75)
    expect(overallPercent('packages', 99)).toBe(99)
  })
})

describe('progressFromLine', () => {
  it('turns a counter into an overall percentage', () => {
    const update = progressFromLine('packages', '[77/154, 00:11/15:37] install: amsfonts [3542k]')
    expect(update?.phase).toBe('packages')
    expect(update?.percent).toBeGreaterThan(75)
    expect(update?.percent).toBeLessThan(99)
    expect(update?.message).toContain('amsfonts')
    expect(update?.message).toContain('77 of 154')
  })

  it('returns null for a line with no counter, so the last update stands', () => {
    expect(progressFromLine('install', 'running mktexlsr ...')).toBeNull()
  })
})

describe('phaseProgress', () => {
  it('carries the message and lands in the phase’s range', () => {
    const update = phaseProgress('download', 'Downloading…', 0.5)
    expect(update.message).toBe('Downloading…')
    expect(update.percent).toBeGreaterThanOrEqual(0)
    expect(update.percent).toBeLessThanOrEqual(6)
  })
})

describe('formatBytes', () => {
  it('reads as a person would write it', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(250_000)).toBe('250 kB')
    expect(formatBytes(5_200_000)).toBe('5.2 MB')
    expect(formatBytes(174_000_000)).toBe('174 MB')
    expect(formatBytes(4_100_000_000)).toBe('4.10 GB')
  })
})
