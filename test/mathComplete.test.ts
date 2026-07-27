import { describe, it, expect } from 'vitest'
import {
  applyCompletion,
  completionQuery,
  completionsFor
} from '@renderer/editor/wysiwyg/math-complete'

// Completing on `\` is only useful if it fires exactly where a macro name is
// being typed and stays quiet everywhere else — a list that pops up over the
// preview while you type prose inside `\text{}` is worse than no list.

describe('deciding when to complete', () => {
  it('offers completion while a macro name is being typed', () => {
    expect(completionQuery('x = \\alp', 8)).toEqual({ from: 4, word: '\\alp' })
  })

  it('offers everything straight after a bare backslash', () => {
    expect(completionQuery('x = \\', 5)).toEqual({ from: 4, word: '\\' })
  })

  it('stays quiet in ordinary text', () => {
    expect(completionQuery('x = y', 5)).toBeNull()
  })

  it('stays quiet after a row break', () => {
    // `\\alpha` is a row break followed by the letters "alpha", not a macro.
    expect(completionQuery('a \\\\alpha', 9)).toBeNull()
  })

  it('completes the macro the caret is inside, not the line', () => {
    const value = '\\frac{\\alp}{2}'
    expect(completionQuery(value, 10)).toEqual({ from: 6, word: '\\alp' })
  })
})

describe('ranking completions', () => {
  it('puts an exact match first', () => {
    expect(completionsFor('\\sum')[0].name).toBe('\\sum')
  })

  it('prefers prefix matches over substring matches', () => {
    const names = completionsFor('\\al').map((c) => c.name)
    expect(names[0]).toBe('\\alpha')
  })

  it('surfaces the paper’s own macros above equally good built-ins', () => {
    // These are the ones an author actually has to look up — nobody forgets
    // what `\alpha` is called, but `\norm` vs `\nrm` is a trip to the
    // preamble every time.
    const names = completionsFor('\\no', ['\\norm']).map((c) => c.name)
    expect(names[0]).toBe('\\norm')
    expect(names).toContain('\\notin')
  })

  it('still puts an exact match first, paper macro or not', () => {
    // Typing the whole name and pressing Enter has to insert what was typed.
    expect(completionsFor('\\in', ['\\inner'])[0].name).toBe('\\in')
  })

  it('does not list a paper macro twice when it shadows a built-in', () => {
    const names = completionsFor('\\vec', ['\\vec']).map((c) => c.name)
    expect(names.filter((n) => n === '\\vec')).toHaveLength(1)
  })

  it('respects the limit so the list never covers the formula', () => {
    expect(completionsFor('\\', [], 5)).toHaveLength(5)
  })
})

describe('applying a completion', () => {
  it('replaces the typed prefix rather than appending to it', () => {
    const value = 'x = \\alp'
    const completion = completionsFor('\\alp')[0]
    expect(applyCompletion(value, 4, 8, completion).value).toBe('x = \\alpha')
  })

  it('puts the caret inside the first argument of a macro that takes one', () => {
    const completion = completionsFor('\\frac')[0]
    const result = applyCompletion('\\fra', 0, 4, completion)
    expect(result.value).toBe('\\frac{}{}')
    // Landing after `{` is the difference between typing the numerator and
    // navigating to where the numerator goes.
    expect(result.caret).toBe('\\frac{'.length)
  })

  it('leaves the caret at the end for a macro with no arguments', () => {
    const completion = completionsFor('\\alpha')[0]
    const result = applyCompletion('\\alp', 0, 4, completion)
    expect(result.caret).toBe(result.value.length)
  })
})
