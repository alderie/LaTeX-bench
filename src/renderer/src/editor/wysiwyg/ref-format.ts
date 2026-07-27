// Cross-reference and citation text formatting.
//
// Pure string functions, deliberately kept out of the node views: the same
// text has to come out of the editor, the offline preview harness, and any
// export path. When this lived inside CrossRefNodeView the preview rendered
// "→ def:strong" where the editor showed "Definition 3.1", which made the
// harness useless for judging what a reader actually sees.

import type { ResolvedLabel } from './labelRegistry'

export function formatRefs(
  cmd: string,
  resolved: Array<{ key: string; ref: ResolvedLabel | undefined }>
): string {
  if (resolved.length === 0) return '??'

  const renderOne = (entry: { key: string; ref: ResolvedLabel | undefined }): string => {
    if (!entry.ref) return '??'
    switch (cmd) {
      case 'eqref':
        return entry.ref.eqrefText
      case 'ref':
        return entry.ref.shortNumber
      case 'pageref':
        // We don't compute page numbers (no pagination) — fall back to
        // the section/theorem number with a `p.` prefix as a hint.
        return `p. ${entry.ref.shortNumber}`
      default:
        // cref / Cref / autoref / nameref
        return entry.ref.pretty
    }
  }

  // Multi-key cleveref: group by kindLabel so mixed kinds read naturally.
  if (cmd === 'cref' || cmd === 'Cref' || cmd === 'autoref') {
    return formatCleveref(resolved, cmd === 'Cref')
  }

  return resolved.map(renderOne).join(', ')
}

function formatCleveref(
  resolved: Array<{ key: string; ref: ResolvedLabel | undefined }>,
  forceCapital: boolean
): string {
  // If any key is unresolved, fall back to per-item rendering so the user
  // at least sees which key didn't resolve.
  if (resolved.some((r) => !r.ref)) {
    return resolved.map((r) => (r.ref ? r.ref.pretty : '??')).join(', ')
  }
  // Group consecutive same-kind refs: "Theorems 3.1 and 3.2" rather
  // than "Theorem 3.1 and Theorem 3.2".
  type Group = { kindLabel: string; numbers: string[] }
  const groups: Group[] = []
  for (const r of resolved) {
    const ref = r.ref!
    const last = groups[groups.length - 1]
    if (last && last.kindLabel === ref.kindLabel) {
      last.numbers.push(ref.shortNumber)
    } else {
      groups.push({ kindLabel: ref.kindLabel, numbers: [ref.shortNumber] })
    }
  }
  const parts = groups.map((g, idx) => {
    const label = idx === 0 || forceCapital ? g.kindLabel : g.kindLabel.toLowerCase()
    const plural = g.numbers.length > 1 ? pluralise(label) : label
    const nums = formatList(g.numbers)
    return `${plural} ${nums}`
  })
  return formatList(parts)
}

function pluralise(label: string): string {
  // English-only, matches what cleveref's `[capitalise]` does for the
  // kinds we care about.
  if (!label) return label
  return `${label}s`
}

// Oxford-comma list: ["a"] → "a", ["a","b"] → "a and b",
// ["a","b","c"] → "a, b, and c".
function formatList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  const head = items.slice(0, -1).join(', ')
  return `${head}, and ${items[items.length - 1]}`
}


// "1, 2, 3, 5, 7, 8" → "1–3, 5, 7–8". Mirrors natbib's `sort&compress`.
export function formatNumberList(nums: number[]): string {
  if (nums.length === 0) return ''
  const groups: Array<[number, number]> = []
  let start = nums[0]
  let prev = nums[0]
  for (let i = 1; i < nums.length; i++) {
    const n = nums[i]
    if (n === prev + 1) {
      prev = n
    } else if (n === prev) {
      // duplicate — skip
    } else {
      groups.push([start, prev])
      start = n
      prev = n
    }
  }
  groups.push([start, prev])
  return groups
    .map(([a, b]) => (a === b ? `${a}` : a + 1 === b ? `${a}, ${b}` : `${a}–${b}`))
    .join(', ')
}
