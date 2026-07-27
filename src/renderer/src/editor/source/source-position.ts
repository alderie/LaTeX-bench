// Where the caret was when you last left a paper.
//
// Small, but it is the difference between reopening a paper and reopening
// *your place in* a paper. Kept in localStorage rather than the paper file:
// it is a property of this window on this machine, not of the document, and
// it must never end up in a git diff.

const PREFIX = 'source.pos.v1.'
/** Papers remembered before the oldest entries are dropped. */
const MAX_ENTRIES = 60

export interface SourcePosition {
  anchor: number
  head: number
}

export function readSourcePosition(paperId: string): SourcePosition | null {
  try {
    const raw = localStorage.getItem(PREFIX + paperId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SourcePosition>
    if (typeof parsed.anchor !== 'number' || typeof parsed.head !== 'number') return null
    if (parsed.anchor < 0 || parsed.head < 0) return null
    return { anchor: parsed.anchor, head: parsed.head }
  } catch {
    return null
  }
}

export function writeSourcePosition(paperId: string, position: SourcePosition): void {
  try {
    localStorage.setItem(PREFIX + paperId, JSON.stringify(position))
    pruneSourcePositions()
  } catch {
    // A full or unavailable localStorage costs a convenience, not the edit.
  }
}

/**
 * Keep the store bounded.
 *
 * Entries are never otherwise removed — a paper deleted from the library
 * leaves its position behind — so without this the key count grows for the
 * life of the install.
 */
function pruneSourcePositions(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  if (keys.length <= MAX_ENTRIES) return
  // No timestamps to sort by, and adding them would double the write cost;
  // dropping in key order is arbitrary but bounded, and the worst case is
  // that one paper forgets where you were.
  for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) localStorage.removeItem(key)
}
