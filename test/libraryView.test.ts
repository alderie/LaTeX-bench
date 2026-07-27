import { describe, it, expect } from 'vitest'
import { filterPapers, formatRelative, groupPapers } from '@renderer/lib/library-view'
import type { PaperMeta } from '@shared/types'

// The sidebar buckets papers by when they were last edited. The boundaries
// are the whole point, so they're pinned against a fixed clock rather than
// whenever the suite happens to run.

const NOW = new Date('2026-07-27T09:30:00Z').getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function paper(title: string, updatedAt: number): PaperMeta {
  return { id: title, title, createdAt: updatedAt, updatedAt } as PaperMeta
}

describe('grouping papers by recency', () => {
  it('buckets by calendar day, not by rolling 24 hours', () => {
    // Something edited late last night is "Yesterday" to a person, even
    // though it was only ten hours ago.
    const lastNight = new Date('2026-07-26T23:00:00Z').getTime()
    const thisMorning = new Date('2026-07-27T08:00:00Z').getTime()
    const groups = groupPapers([paper('morning', thisMorning), paper('night', lastNight)], NOW)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
  })

  it('drops buckets that would be empty', () => {
    const groups = groupPapers([paper('a', NOW - HOUR)], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Today')
  })

  it('separates the last week from the last month from everything else', () => {
    const groups = groupPapers(
      [
        paper('recent', NOW - 3 * DAY),
        paper('older', NOW - 12 * DAY),
        paper('ancient', NOW - 200 * DAY)
      ],
      NOW
    )
    expect(groups.map((g) => g.label)).toEqual([
      'Previous 7 days',
      'Previous 30 days',
      'Older'
    ])
  })

  it('keeps the order it was given inside a bucket', () => {
    // The store sorts by most-recent-first; grouping must not reshuffle it.
    const groups = groupPapers([paper('first', NOW - HOUR), paper('second', NOW - 2 * HOUR)], NOW)
    expect(groups[0].papers.map((p) => p.title)).toEqual(['first', 'second'])
  })
})

describe('filtering papers', () => {
  const papers = [
    paper('Convergence Guarantees for Mirror Descent', NOW),
    paper('Notes on sampling', NOW)
  ]

  it('matches a plain substring', () => {
    expect(filterPapers(papers, 'mirror')).toHaveLength(1)
  })

  it('matches a subsequence, so initials find a long title', () => {
    // Paper titles are long; typing a contiguous run of one is most of the
    // work you were trying to skip.
    expect(filterPapers(papers, 'cgmd')[0].title).toContain('Convergence')
  })

  it('returns everything for an empty query', () => {
    expect(filterPapers(papers, '   ')).toHaveLength(2)
  })
})

describe('relative timestamps', () => {
  it('reads as a person would say it', () => {
    expect(formatRelative(NOW - 30 * 1000, NOW)).toBe('just now')
    expect(formatRelative(NOW - 5 * 60 * 1000, NOW)).toBe('5m ago')
    expect(formatRelative(NOW - 3 * HOUR, NOW)).toBe('3h ago')
    expect(formatRelative(NOW - 4 * DAY, NOW)).toBe('4d ago')
  })

  it('falls back to a date once "d ago" stops meaning anything', () => {
    expect(formatRelative(NOW - 400 * DAY, NOW)).toMatch(/\d/)
    expect(formatRelative(NOW - 400 * DAY, NOW)).not.toContain('ago')
  })
})
