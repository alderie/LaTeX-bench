import { SearchQuery } from '@codemirror/search'
import type { EditorState } from '@codemirror/state'

// The part of find/replace that has no UI in it.
//
// The widget itself is React and the navigation is CodeMirror's own
// commands; what lives here is the arithmetic between the two — turning the
// three toggles into a query, and turning a query into "3 of 17". Both are
// worth having as plain functions: they are the parts that are easy to get
// subtly wrong (an invalid regex mid-typing, a count that disagrees with
// what the highlighter drew) and easy to test.

/** The three toggles, VS Code's set. */
export interface FindOptions {
  caseSensitive: boolean
  regexp: boolean
  wholeWord: boolean
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  caseSensitive: false,
  regexp: false,
  wholeWord: false
}

/**
 * Counting stops here.
 *
 * A count is a reassurance ("this touches 12 places"), and past a few
 * thousand it stops being one — nobody reads "8,412 of 61,203" as anything
 * but "lots". Capping keeps a pathological query (`.` over a long paper, in
 * regex mode, typed one character at a time) from walking the whole document
 * on every keystroke.
 */
export const MATCH_LIMIT = 5000

export interface MatchSummary {
  /** Total matches found, up to `MATCH_LIMIT`. */
  count: number
  /** 1-based index of the match the selection is sitting on; 0 when none. */
  current: number
  /** True when counting stopped at the limit and there may be more. */
  capped: boolean
  /** 1-based line numbers of each match, for the minimap's tick marks. */
  lines: number[]
  /** Why the query is unusable, if it is — an invalid regex, typically. */
  error: string | null
}

export const NO_MATCHES: MatchSummary = {
  count: 0,
  current: 0,
  capped: false,
  lines: [],
  error: null
}

/**
 * Why a regex source won't compile, in the shortest form worth showing.
 *
 * Returns null for a valid pattern. `RegExp` messages are prefixed with the
 * pattern itself ("Invalid regular expression: /foo(/: Unterminated group"),
 * which is noise in a widget that is already showing the pattern.
 */
export function regexError(source: string): string | null {
  if (!source) return null
  try {
    new RegExp(source, 'u')
    return null
  } catch (err) {
    const message = (err as Error).message
    const colon = message.lastIndexOf(': ')
    return colon === -1 ? message : message.slice(colon + 2)
  }
}

/** The three toggles plus the two strings, as CodeMirror wants them. */
export function buildQuery(search: string, replace: string, options: FindOptions): SearchQuery {
  return new SearchQuery({
    search,
    replace,
    caseSensitive: options.caseSensitive,
    regexp: options.regexp,
    wholeWord: options.wholeWord,
    // `\n` and `\t` in the find field mean newline and tab, which is what
    // someone typing them into a find field means by them.
    literal: false
  })
}

/** The empty query, which is how highlighting gets cleared. */
export function emptyQuery(): SearchQuery {
  return new SearchQuery({ search: '' })
}

/**
 * How many matches there are, and which one the selection is on.
 *
 * "Which one" is exact: the count advances only when the selection covers a
 * match precisely, which is what CodeMirror's `findNext` leaves behind. A
 * caret parked mid-document reports `current: 0`, and the widget says
 * "17 results" rather than claiming a position it doesn't have.
 */
export function summarizeMatches(
  state: EditorState,
  query: SearchQuery,
  selectionFrom: number,
  selectionTo: number
): MatchSummary {
  if (!query.search) return NO_MATCHES
  if (query.regexp) {
    const error = regexError(query.search)
    if (error) return { ...NO_MATCHES, error }
  }
  if (!query.valid) return NO_MATCHES

  const lines: number[] = []
  let count = 0
  let current = 0
  let capped = false

  const cursor = query.getCursor(state)
  for (;;) {
    const step = cursor.next()
    if (step.done) break
    const { from, to } = step.value
    count++
    if (from === selectionFrom && to === selectionTo) current = count
    lines.push(state.doc.lineAt(from).number)
    if (count >= MATCH_LIMIT) {
      capped = true
      break
    }
  }

  return { count, current, capped, lines, error: null }
}

/**
 * The label between the find field and the arrows.
 *
 * Mirrors VS Code: a position when there is one, a bare total when the caret
 * isn't on a match, and "No results" rather than "0 of 0" — which reads as a
 * broken counter rather than an answer.
 */
export function describeMatches(summary: MatchSummary, hasQuery: boolean): string {
  if (summary.error) return 'Invalid regex'
  if (!hasQuery) return ''
  if (summary.count === 0) return 'No results'
  const total = summary.capped ? `${MATCH_LIMIT}+` : String(summary.count)
  return summary.current > 0 ? `${summary.current} of ${total}` : `${total} results`
}
