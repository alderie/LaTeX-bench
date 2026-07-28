// The paper's `references.bib`, turned into something the editor can use.
//
// The file was already being read on open and written back on change, and
// then nothing consumed it: `\cite{` completed only from in-document
// `\bibitem`s, so the normal BibTeX workflow — a `.bib` next to the paper and
// `\bibliography{references}` at the end — got no completion at all and every
// citation rendered as an unresolved chip.
//
// This module is the missing consumer. It parses the file into a flat entry
// list, derives the two strings the rest of the editor wants (a short
// author-year label for inline display, a one-line summary for a completion
// row), and publishes them through a small subscribable registry — the same
// shape `labelRegistry` uses, because the consumers are the same kind of
// thing: node views and completion sources that live outside React.

// Type-only: erased at compile time, so it doesn't pull the parser into the
// bundle the way the `import(…)` below deliberately doesn't.
import type { Entry as BibtexEntry } from '@retorquere/bibtex-parser'

export interface BibEntry {
  /** The cite key: the thing that goes inside `\cite{…}`. */
  key: string
  /** `article`, `inproceedings`, `book`, … */
  type: string
  title: string
  /** Family names, in the order the entry lists them. */
  authors: string[]
  year: string
  /** Journal, booktitle, publisher — wherever it appeared. */
  venue: string
  /** `Tsallis et al., 1988` — for author-year citation styles. */
  shortLabel: string
  /** One line of "who, what, where" for a completion row. */
  summary: string
  doi: string
  url: string
}

/**
 * Parse a BibTeX file.
 *
 * The parser is a heavy dependency (it carries a Unicode/LaTeX translation
 * table), so it is imported on demand — the same treatment the unified-latex
 * modules get. A paper with no citations never pays for it.
 */
export async function parseBibliography(source: string): Promise<BibEntry[]> {
  if (!source.trim()) return []
  const { parse } = await import('@retorquere/bibtex-parser')
  // `sentenceCase` is on by default and rewrites `{B}oltzmann-{G}ibbs` to
  // `Boltzmann-gibbs`. The author already chose their capitalisation.
  const library = parse(source, { sentenceCase: false, applyCrossRef: true })
  return library.entries.map(toBibEntry)
}

function toBibEntry(entry: BibtexEntry): BibEntry {
  const fields = entry.fields as Record<string, unknown>
  const authors = creatorNames(fields.author)
  const editors = creatorNames(fields.editor)
  const people = authors.length ? authors : editors
  const year = firstString(fields.year) || yearFromDate(firstString(fields.date))
  const title = firstString(fields.title)
  const venue =
    firstString(fields.journal) ||
    firstString(fields.booktitle) ||
    firstString(fields.publisher) ||
    firstString(fields.institution) ||
    firstString(fields.school) ||
    firstString(fields.howpublished)

  return {
    key: entry.key,
    type: entry.type,
    title,
    authors: people,
    year,
    venue,
    shortLabel: shortLabelFor(people, year, title),
    summary: summaryFor(people, year, title, venue),
    doi: firstString(fields.doi),
    url: firstString(fields.url)
  }
}

/**
 * Family names from a creator list.
 *
 * The parser splits `Tsallis, Constantino` into parts but falls back to a
 * single `name` for institutional authors (`{CERN}`), which have no family
 * name to take.
 */
function creatorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const creator of value) {
    if (!creator || typeof creator !== 'object') continue
    const c = creator as { name?: string; lastName?: string; prefix?: string }
    const family = c.lastName ? [c.prefix, c.lastName].filter(Boolean).join(' ') : c.name
    if (family) out.push(family.trim())
  }
  return out
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
  return ''
}

/** biblatex's `date = {2019-04}` carries the year the `year` field would. */
function yearFromDate(date: string): string {
  return /^(\d{4})/.exec(date)?.[1] ?? ''
}

/**
 * The inline form an author-year style would print: `Tsallis et al., 1988`.
 *
 * Three or more authors collapse to `et al.`, two are joined with `&`, and an
 * entry with no author at all falls back to its title — which is what a
 * bibliography style does with `@misc` and standards documents.
 */
export function shortLabelFor(authors: string[], year: string, title: string): string {
  const suffix = year ? `, ${year}` : ''
  if (authors.length === 0) {
    const stub = title ? truncate(title, 28) : ''
    return stub ? `${stub}${suffix}` : year || '?'
  }
  if (authors.length === 1) return `${authors[0]}${suffix}`
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}${suffix}`
  return `${authors[0]} et al.${suffix}`
}

function summaryFor(authors: string[], year: string, title: string, venue: string): string {
  const who = authors.length ? shortLabelFor(authors, year, title) : year
  const parts = [who, title, venue].filter(Boolean)
  return parts.join(' · ')
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…'
}

// ── Registry ───────────────────────────────────────────────────────────
//
// Module-level rather than in a React store, for the same reason the label
// registry is: the consumers are a CodeMirror completion source and a
// ProseMirror node view, neither of which is inside the React tree.

let entries: BibEntry[] = []
let byKey = new Map<string, BibEntry>()
const listeners = new Set<() => void>()

export function getBibEntries(): BibEntry[] {
  return entries
}

export function getBibEntry(key: string): BibEntry | undefined {
  return byKey.get(key)
}

export function subscribeBibliography(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Replace the current bibliography and wake every consumer. */
export function setBibEntries(next: BibEntry[]): void {
  entries = next
  byKey = new Map(next.map((entry) => [entry.key, entry]))
  for (const listener of listeners) {
    try {
      listener()
    } catch (err) {
      console.error('[bibliography] subscriber threw', err)
    }
  }
}

/**
 * Parse a `.bib` and publish it, ignoring a stale result.
 *
 * Parsing is async and the user can switch papers mid-flight, so each call
 * takes a token and only the newest one is allowed to publish. Without this,
 * opening paper B while A's bibliography is still parsing leaves B showing
 * A's references.
 */
let generation = 0

export async function loadBibliography(source: string): Promise<void> {
  const token = ++generation
  try {
    const parsed = await parseBibliography(source)
    if (token !== generation) return
    setBibEntries(parsed)
  } catch (err) {
    if (token !== generation) return
    // A half-typed `.bib` is a normal intermediate state, not an error worth
    // interrupting anyone over. Keep the last good parse.
    console.warn('[bibliography] parse failed:', err)
  }
}
