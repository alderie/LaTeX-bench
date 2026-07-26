import type { Node as PMNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { getLabel, subscribe, type ResolvedLabel } from '../labelRegistry'

class CrossRefView implements NodeView {
  dom: HTMLElement
  private unsubscribe: () => void

  constructor(private node: PMNode) {
    this.dom = document.createElement('a')
    this.dom.className = 'cross-ref'
    this.dom.contentEditable = 'false'
    this.render()
    // Re-render whenever the registry rebuilds — section/theorem
    // numbering can shift around in response to edits elsewhere.
    this.unsubscribe = subscribe(() => this.render())
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  private render(): void {
    const cmd = (this.node.attrs.cmd as string) || 'ref'
    const keys = (this.node.attrs.keys as string[]) ?? []
    const fallbackKey = (this.node.attrs.label as string) || ''
    const effectiveKeys = keys.length > 0 ? keys : fallbackKey ? [fallbackKey] : []

    const resolved = effectiveKeys.map((k) => ({ key: k, ref: getLabel(k) }))
    const allResolved = resolved.every((r) => r.ref !== undefined)

    this.dom.classList.toggle('cross-ref--unresolved', !allResolved)
    // First (or only) anchor is what we link to. Multi-key cleveref
    // points to the first key — matches LaTeX's behaviour.
    const firstAnchor = resolved.find((r) => r.ref !== undefined)?.ref?.domAnchor
    if (firstAnchor) {
      ;(this.dom as HTMLAnchorElement).href = `#${firstAnchor}`
    } else {
      this.dom.removeAttribute('href')
    }
    this.dom.title = effectiveKeys.join(', ')

    this.dom.textContent = formatRefs(cmd, resolved)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.unsubscribe()
  }
}

function formatRefs(
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

export const crossRefNodeView: NodeViewConstructor = (node) => new CrossRefView(node)
