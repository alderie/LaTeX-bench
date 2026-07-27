import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  MATCH_LIMIT,
  buildQuery,
  describeMatches,
  emptyQuery,
  regexError,
  summarizeMatches,
  type FindOptions
} from '@renderer/editor/source/search-model'

// The find widget's arithmetic. What is worth testing here is the gap
// between what the highlighter paints and what the counter says: they read
// the same query, so any disagreement is a bug in this file.

const PLAIN: FindOptions = {
  caseSensitive: false,
  regexp: false,
  wholeWord: false
}

function state(doc: string): EditorState {
  return EditorState.create({ doc })
}

describe('regexError', () => {
  it('accepts a valid pattern', () => {
    expect(regexError('\\\\section\\{(.*)\\}')).toBeNull()
    expect(regexError('')).toBeNull()
  })

  it('reports the reason without repeating the pattern back', () => {
    const message = regexError('foo(')
    expect(message).toBeTruthy()
    // The widget already shows the pattern; echoing it in the error is noise.
    expect(message).not.toContain('foo(')
  })
})

describe('summarizeMatches', () => {
  it('counts every occurrence and records its line', () => {
    const doc = state('alpha beta\nalpha gamma\ndelta')
    const summary = summarizeMatches(doc, buildQuery('alpha', '', PLAIN), 0, 0)
    expect(summary.count).toBe(2)
    expect(summary.lines).toEqual([1, 2])
    expect(summary.error).toBeNull()
  })

  it('reports the position only when the selection covers a match exactly', () => {
    const doc = state('alpha alpha alpha')
    const query = buildQuery('alpha', '', PLAIN)
    // Caret parked on the second match.
    expect(summarizeMatches(doc, query, 6, 11).current).toBe(2)
    // Caret merely near one: a position would be a claim we can't support.
    expect(summarizeMatches(doc, query, 7, 7).current).toBe(0)
  })

  it('honours case sensitivity', () => {
    const doc = state('Alpha alpha')
    expect(summarizeMatches(doc, buildQuery('alpha', '', PLAIN), 0, 0).count).toBe(2)
    expect(
      summarizeMatches(doc, buildQuery('alpha', '', { ...PLAIN, caseSensitive: true }), 0, 0).count
    ).toBe(1)
  })

  it('honours whole-word matching', () => {
    const doc = state('sub subsection sub')
    expect(summarizeMatches(doc, buildQuery('sub', '', PLAIN), 0, 0).count).toBe(3)
    expect(
      summarizeMatches(doc, buildQuery('sub', '', { ...PLAIN, wholeWord: true }), 0, 0).count
    ).toBe(2)
  })

  it('runs the query as a regex when asked', () => {
    const doc = state('\\section{One}\n\\subsection{Two}\n\\section{Three}')
    const summary = summarizeMatches(
      doc,
      buildQuery('\\\\section\\{[^}]*\\}', '', { ...PLAIN, regexp: true }),
      0,
      0
    )
    expect(summary.count).toBe(2)
    expect(summary.lines).toEqual([1, 3])
  })

  it('reports an unusable regex instead of counting nothing silently', () => {
    const summary = summarizeMatches(
      state('anything'),
      buildQuery('foo(', '', { ...PLAIN, regexp: true }),
      0,
      0
    )
    expect(summary.error).toBeTruthy()
    expect(summary.count).toBe(0)
  })

  it('finds nothing for an empty query', () => {
    expect(summarizeMatches(state('alpha'), emptyQuery(), 0, 0).count).toBe(0)
  })

  it('stops counting at the limit rather than walking a huge document', () => {
    const doc = state('x'.repeat(MATCH_LIMIT + 500))
    const summary = summarizeMatches(doc, buildQuery('x', '', PLAIN), 0, 0)
    expect(summary.count).toBe(MATCH_LIMIT)
    expect(summary.capped).toBe(true)
  })
})

describe('describeMatches', () => {
  const base = { count: 0, current: 0, capped: false, lines: [], error: null }

  it('says nothing until there is a query', () => {
    expect(describeMatches(base, false)).toBe('')
  })

  it('distinguishes "no results" from a position of zero', () => {
    expect(describeMatches(base, true)).toBe('No results')
  })

  it('reads as a position when the caret is on a match', () => {
    expect(describeMatches({ ...base, count: 17, current: 3 }, true)).toBe('3 of 17')
  })

  it('falls back to a bare total when the caret is elsewhere', () => {
    expect(describeMatches({ ...base, count: 17 }, true)).toBe('17 results')
  })

  it('marks a capped count so the number is not read as exact', () => {
    expect(describeMatches({ ...base, count: MATCH_LIMIT, capped: true, current: 1 }, true)).toBe(
      `1 of ${MATCH_LIMIT}+`
    )
  })

  it('leads with the regex problem over any count', () => {
    expect(describeMatches({ ...base, error: 'Unterminated group' }, true)).toBe('Invalid regex')
  })
})
