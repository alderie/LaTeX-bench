// Undo and redo inside a block editor.
//
// A formula's own undo used to be whatever the browser gave a `<textarea>`,
// which was worse than nothing here. The editor writes to that field from
// several places besides the keyboard — a cell edited in the rendering, a row
// added to a matrix, an environment switched, a label renamed — and assigning
// to `value` clears the field's native undo stack outright. So one cell edit
// threw away the history of everything typed before it, and the edit itself
// could not be undone at all. The only way back was Escape, which throws away
// the whole formula.
//
// It also isn't ProseMirror's undo. The document's history holds one step for
// the whole block: it can put the formula back the way it was before you
// opened it, and it can do nothing at all until you close it — and while the
// editor is open its node view swallows the keystroke, so ⌘Z inside a formula
// never reaches it. What's missing is a history for the edit in progress, and
// this is it: snapshots of the surface, taken by the editor whenever it
// changes the source, in whatever way.
//
// Typing coalesces — a run of keystrokes is one step, as in every editor —
// and anything structural stands on its own, because "add a row" is a thing
// an author means to undo in one go.

export interface EditHistoryOptions<S> {
  /** Put a snapshot back on the surface. */
  restore: (state: S, caret: number) => void
  /** Keystrokes this close together are one step. */
  coalesceMs?: number
  /** Injectable clock, so coalescing is testable without waiting. */
  now?: () => number
}

interface Entry<S> {
  state: S
  caret: number
  /** When it was taken, for coalescing. */
  at: number
  /** Whether the next keystroke may absorb it. */
  open: boolean
}

export class EditHistory<S> {
  private entries: Array<Entry<S>>
  private index = 0
  private readonly coalesceMs: number
  private readonly now: () => number

  constructor(initial: S, caret: number, private options: EditHistoryOptions<S>) {
    this.coalesceMs = options.coalesceMs ?? 500
    this.now = options.now ?? Date.now
    this.entries = [{ state: initial, caret, at: this.now(), open: false }]
  }

  /**
   * Note what the surface now holds.
   *
   * `kind` is the difference between a keystroke and an edit: a run of
   * keystrokes collapses into the entry it started, so undo goes back a word
   * rather than a letter, while a structural change is always its own step.
   */
  record(state: S, caret: number, kind: 'type' | 'step' = 'step'): void {
    const current = this.entries[this.index]
    if (same(current.state, state)) {
      current.caret = caret
      return
    }
    // Anything recorded after an undo is a new branch; the redos it replaces
    // are gone, which is what every editor does and what people expect.
    this.entries.length = this.index + 1

    const at = this.now()
    if (kind === 'type' && current.open && at - current.at <= this.coalesceMs) {
      current.state = state
      current.caret = caret
      current.at = at
      // Typing that ends where it started — a cell typed into and then
      // reverted — leaves two identical entries, and the undo between them
      // would look like the key did nothing.
      this.dropIfUnchanged()
      return
    }
    this.entries.push({ state, caret, at, open: kind === 'type' })
    this.index = this.entries.length - 1
  }

  private dropIfUnchanged(): void {
    if (this.index === 0) return
    if (!same(this.entries[this.index - 1].state, this.entries[this.index].state)) return
    this.entries.pop()
    this.index--
  }

  /** Close the run of keystrokes, so the next one starts a new step. */
  seal(): void {
    this.entries[this.index].open = false
  }

  undo(): boolean {
    if (this.index === 0) return false
    this.seal()
    this.index--
    this.apply()
    return true
  }

  redo(): boolean {
    if (this.index >= this.entries.length - 1) return false
    this.index++
    this.apply()
    return true
  }

  /**
   * Handle the undo keys, for a surface that has taken its own undo over.
   *
   * Returns whether it did, which the caller turns into a `preventDefault` —
   * without that the field's native undo runs as well, on a stack that only
   * knows about the characters that were typed into it.
   */
  handleKey(event: KeyboardEvent): boolean {
    if (event.altKey || !(event.metaKey || event.ctrlKey)) return false
    const key = event.key.toLowerCase()
    if (key === 'z') return event.shiftKey ? this.redo() : this.undo()
    // The Windows spelling of redo. Not on macOS, where ⌘Y is something else.
    if (key === 'y' && !event.metaKey) return this.redo()
    return false
  }

  private apply(): void {
    const entry = this.entries[this.index]
    entry.open = false
    this.options.restore(entry.state, entry.caret)
  }
}

/**
 * Whether two snapshots hold the same thing.
 *
 * The states here are small records of strings and flags — a body and its
 * wrapper, a table's source — so comparing them as text is honest and saves
 * every caller from writing the same comparator.
 */
function same<S>(a: S, b: S): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
