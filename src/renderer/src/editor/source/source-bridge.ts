import type { EditorView } from '@codemirror/view'

// A narrow channel between the React chrome (the find/replace widget, the
// status line) and the CodeMirror view, which lives outside React.
//
// Same shape as the ProseMirror `editor-bridge`: the view sits in a
// module-level slot rather than in a store, because putting a mutable,
// deeply-nested object in zustand would make every transaction a candidate
// for a React re-render. Chrome that needs to know *something changed*
// subscribes to `subscribeSourceUpdate` and reads what it needs on demand.

type Listener = () => void

let activeView: EditorView | null = null

const viewListeners = new Set<Listener>()
const updateListeners = new Set<Listener>()

function emit(set: Set<Listener>): void {
  for (const listener of set) listener()
}

export function setActiveSourceView(view: EditorView | null): void {
  if (activeView === view) return
  activeView = view
  emit(viewListeners)
}

export function getActiveSourceView(): EditorView | null {
  return activeView
}

/** Fires when the source editor mounts or unmounts. */
export function subscribeSourceView(listener: Listener): () => void {
  viewListeners.add(listener)
  return () => viewListeners.delete(listener)
}

let pending = false

/**
 * Fires on every doc/selection change in the source editor.
 *
 * Coalesced to one call per frame: the find widget recounts matches from
 * this and the minimap repaints from it, and doing either once per keystroke
 * of a held-down key is work nobody sees.
 */
export function notifySourceUpdate(): void {
  if (pending) return
  pending = true
  const flush = (): void => {
    pending = false
    emit(updateListeners)
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
  else queueMicrotask(flush)
}

export function subscribeSourceUpdate(listener: Listener): () => void {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}
