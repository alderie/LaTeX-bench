import type { PaperMeta } from '@shared/types'

// How the paper list is presented in the sidebar.
//
// A flat list sorted by "most recently edited" is correct and unreadable:
// every row looks the same, and "3d ago" on row four tells you nothing until
// you've read rows one to three. Bucketing by recency gives the list a shape
// you can navigate by position — the thing you touched this morning is under
// "Today", not eleventh.
//
// Kept out of the component so the bucket boundaries can be tested against a
// fixed clock instead of whatever time the suite happens to run at.

export interface PaperGroup {
  label: string
  papers: PaperMeta[]
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`
  return new Date(ts).toLocaleDateString()
}

/**
 * Bucket papers by when they were last edited.
 *
 * Boundaries are calendar days rather than rolling 24-hour windows: at 9am,
 * something edited at 11pm last night is "Yesterday" to a person, not
 * "Today" because it was ten hours ago.
 */
export function groupPapers(papers: PaperMeta[], now = Date.now()): PaperGroup[] {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()

  const buckets: PaperGroup[] = [
    { label: 'Today', papers: [] },
    { label: 'Yesterday', papers: [] },
    { label: 'Previous 7 days', papers: [] },
    { label: 'Previous 30 days', papers: [] },
    { label: 'Older', papers: [] }
  ]

  for (const paper of papers) {
    const at = paper.updatedAt
    if (at >= today) buckets[0].papers.push(paper)
    else if (at >= today - DAY) buckets[1].papers.push(paper)
    else if (at >= today - 7 * DAY) buckets[2].papers.push(paper)
    else if (at >= today - 30 * DAY) buckets[3].papers.push(paper)
    else buckets[4].papers.push(paper)
  }

  return buckets.filter((bucket) => bucket.papers.length > 0)
}

/**
 * Filter by title. Matches on a subsequence so `hvt` finds "Heavy-Tailed
 * Noise" — paper titles are long, and typing a contiguous run of one is
 * most of the work you were trying to avoid.
 */
export function filterPapers(papers: PaperMeta[], query: string): PaperMeta[] {
  const q = query.trim().toLowerCase()
  if (q === '') return papers
  return papers.filter((paper) => matches(paper.title.toLowerCase(), q))
}

function matches(title: string, query: string): boolean {
  if (title.includes(query)) return true
  let i = 0
  for (const ch of title) {
    if (ch === query[i]) i++
    if (i === query.length) return true
  }
  return false
}

/** Show the filter only once the list is long enough to need one. */
export const FILTER_THRESHOLD = 6
