import { describe, it, expect, beforeEach } from 'vitest'
import {
  getBibEntries,
  getBibEntry,
  loadBibliography,
  parseBibliography,
  setBibEntries,
  shortLabelFor,
  subscribeBibliography
} from '@renderer/editor/bibliography'

// The `.bib` the app was already reading and then ignoring.

const BIB = `
@article{tsallis1988,
  author  = {Tsallis, Constantino},
  title   = {Possible generalization of {B}oltzmann--{G}ibbs statistics},
  journal = {Journal of Statistical Physics},
  year    = {1988},
  doi     = {10.1007/BF01016429}
}

@inproceedings{smith2020,
  author    = {Smith, Jane and Doe, John},
  title     = {A study of things},
  booktitle = {Proceedings of Things},
  year      = {2020}
}

@article{many2015,
  author  = {Alpha, A. and Beta, B. and Gamma, C.},
  title   = {Three authors},
  journal = {Journal of Many},
  year    = {2015}
}

@misc{standard,
  title = {A Document With No Author},
  year  = {1999}
}
`

describe('parseBibliography', () => {
  it('returns one entry per record, keyed by cite key', async () => {
    const entries = await parseBibliography(BIB)
    expect(entries.map((e) => e.key)).toEqual(['tsallis1988', 'smith2020', 'many2015', 'standard'])
  })

  it('preserves the author’s capitalisation', async () => {
    // The parser sentence-cases titles by default, which would turn
    // `{B}oltzmann--{G}ibbs` into `Boltzmann-gibbs`.
    const [tsallis] = await parseBibliography(BIB)
    expect(tsallis.title).toContain('Boltzmann')
    expect(tsallis.title).toContain('Gibbs')
  })

  it('pulls out family names, year and venue', async () => {
    const entries = await parseBibliography(BIB)
    const tsallis = entries.find((e) => e.key === 'tsallis1988')!
    expect(tsallis.authors).toEqual(['Tsallis'])
    expect(tsallis.year).toBe('1988')
    expect(tsallis.venue).toBe('Journal of Statistical Physics')
    expect(tsallis.doi).toBe('10.1007/BF01016429')
  })

  it('falls back to booktitle for a conference paper', async () => {
    const entries = await parseBibliography(BIB)
    expect(entries.find((e) => e.key === 'smith2020')!.venue).toBe('Proceedings of Things')
  })

  it('builds a summary that identifies the work', async () => {
    const entries = await parseBibliography(BIB)
    const summary = entries.find((e) => e.key === 'smith2020')!.summary
    expect(summary).toContain('Smith & Doe, 2020')
    expect(summary).toContain('A study of things')
  })

  it('returns nothing for an empty file', async () => {
    expect(await parseBibliography('')).toEqual([])
    expect(await parseBibliography('   \n  ')).toEqual([])
  })

  it('reads biblatex’s date field when there is no year', async () => {
    const entries = await parseBibliography(
      '@article{k, author = {Rey, Ann}, title = {T}, date = {2019-04-02}}'
    )
    expect(entries[0].year).toBe('2019')
  })
})

describe('shortLabelFor', () => {
  it('names a single author', () => {
    expect(shortLabelFor(['Tsallis'], '1988', 'T')).toBe('Tsallis, 1988')
  })

  it('joins two authors', () => {
    expect(shortLabelFor(['Smith', 'Doe'], '2020', 'T')).toBe('Smith & Doe, 2020')
  })

  it('collapses three or more to et al.', () => {
    expect(shortLabelFor(['Alpha', 'Beta', 'Gamma'], '2015', 'T')).toBe('Alpha et al., 2015')
  })

  it('falls back to the title when there is no author', () => {
    expect(shortLabelFor([], '1999', 'A Document With No Author')).toContain('1999')
    expect(shortLabelFor([], '1999', 'A Document With No Author')).toContain('A Document')
  })

  it('copes with a missing year', () => {
    expect(shortLabelFor(['Tsallis'], '', 'T')).toBe('Tsallis')
  })
})

describe('the registry', () => {
  beforeEach(() => {
    setBibEntries([])
  })

  it('publishes entries and looks them up by key', async () => {
    await loadBibliography(BIB)
    expect(getBibEntries()).toHaveLength(4)
    expect(getBibEntry('tsallis1988')?.authors).toEqual(['Tsallis'])
    expect(getBibEntry('nope')).toBeUndefined()
  })

  it('wakes subscribers when the bibliography changes', async () => {
    let woken = 0
    const off = subscribeBibliography(() => {
      woken++
    })
    await loadBibliography(BIB)
    expect(woken).toBe(1)
    off()
    await loadBibliography('')
    expect(woken).toBe(1)
  })

  it('lets the newest load win when two overlap', async () => {
    // Switching papers while the first `.bib` is still parsing must not
    // leave the second paper showing the first one's references.
    const first = loadBibliography(BIB)
    const second = loadBibliography('@book{only, title = {Only}, year = {2001}}')
    await Promise.all([first, second])
    expect(getBibEntries().map((e) => e.key)).toEqual(['only'])
  })
})
