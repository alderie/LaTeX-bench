import { describe, it, expect } from 'vitest'
import { EditHistory } from '@renderer/editor/wysiwyg/editors/edit-history'

// The undo stack a block editor keeps for the edit in progress. The clock is
// injected because coalescing is the whole point of it and waiting half a
// second per assertion is not a test.

interface Harness {
  history: EditHistory<string>
  state: () => string
  tick: (ms: number) => void
}

function open(initial = 'a'): Harness {
  let now = 1000
  let restored = initial
  const history = new EditHistory<string>(initial, 0, {
    restore: (state) => {
      restored = state
    },
    now: () => now
  })
  return {
    history,
    state: () => restored,
    tick: (ms) => {
      now += ms
    }
  }
}

describe('the block editors’ undo stack', () => {
  it('goes back a step and forward again', () => {
    const { history, state } = open('a')
    history.record('ab', 0)
    history.record('abc', 0)
    expect(history.undo()).toBe(true)
    expect(state()).toBe('ab')
    expect(history.redo()).toBe(true)
    expect(state()).toBe('abc')
  })

  it('collapses a run of keystrokes into one step', () => {
    // Undo goes back a word, the way it does everywhere else — a letter at a
    // time is nobody's idea of undo.
    const { history, state, tick } = open('')
    for (const value of ['w', 'wo', 'wor', 'word']) {
      history.record(value, 0, 'type')
      tick(50)
    }
    expect(history.undo()).toBe(true)
    expect(state()).toBe('')
  })

  it('starts a new step when typing pauses', () => {
    const { history, state, tick } = open('')
    history.record('one', 0, 'type')
    tick(900)
    history.record('one two', 0, 'type')
    history.undo()
    expect(state()).toBe('one')
  })

  it('keeps a structural change out of the run either side of it', () => {
    // "Add a row" is a thing an author means to undo in one go, not something
    // that absorbs the letters typed just before it.
    const { history, state } = open('a & b')
    history.record('ab', 0, 'type')
    history.record('ab \\\\\n & ', 0, 'step')
    history.record('ab \\\\\n c & ', 0, 'type')
    history.undo()
    expect(state()).toBe('ab \\\\\n & ')
    history.undo()
    expect(state()).toBe('ab')
  })

  it('drops a run that ends where it began', () => {
    // A cell typed into and then reverted. Without this the undo between the
    // two identical states looks like the key did nothing.
    const { history, state } = open('x')
    history.record('xy', 0, 'type')
    history.record('x', 0, 'type')
    expect(history.undo()).toBe(false)
    expect(state()).toBe('x')
  })

  it('throws away the redos a new edit branches off from', () => {
    const { history, state } = open('a')
    history.record('ab', 0)
    history.undo()
    history.record('ac', 0)
    expect(history.redo()).toBe(false)
    expect(state()).toBe('a')
  })

  it('stops at the state the editor opened with', () => {
    const { history } = open('a')
    history.record('ab', 0)
    expect(history.undo()).toBe(true)
    expect(history.undo()).toBe(false)
  })

  it('answers only for the undo keys, and says whether it acted', () => {
    const { history } = open('a')
    history.record('ab', 0)
    const key = (init: KeyboardEventInit): KeyboardEvent =>
      new window.KeyboardEvent('keydown', init)
    expect(history.handleKey(key({ key: 'b', metaKey: true }))).toBe(false)
    expect(history.handleKey(key({ key: 'z' }))).toBe(false)
    // Nothing to undo is not the same as not a shortcut: the caller uses the
    // answer to decide whether the field's own undo should still run.
    expect(history.handleKey(key({ key: 'z', metaKey: true }))).toBe(true)
    expect(history.handleKey(key({ key: 'z', metaKey: true }))).toBe(false)
    expect(history.handleKey(key({ key: 'z', metaKey: true, shiftKey: true }))).toBe(true)
    // Ctrl+Y is the Windows spelling of redo; ⌘Y on macOS is something else.
    history.undo()
    expect(history.handleKey(key({ key: 'y', ctrlKey: true }))).toBe(true)
    history.undo()
    expect(history.handleKey(key({ key: 'y', metaKey: true }))).toBe(false)
  })
})
