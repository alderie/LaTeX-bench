// Going to a place in the paper, from anywhere in the chrome.
//
// Three things now ask for this — the outline panel, the command palette,
// and a build error you clicked — and the target can be in a file that isn't
// open, in a view that isn't showing. Doing it in one place keeps those three
// from each getting a slightly different version of "and then scroll to it".

import { EditorView } from '@codemirror/view'
import { TextSelection } from 'prosemirror-state'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import { getActiveSourceView } from './source/source-bridge'
import { getActiveEditorView } from './wysiwyg/editor-bridge'

export interface JumpTarget {
  /** Paper-relative file. Defaults to whatever is already open. */
  file?: string
  /** Zero-based source line. */
  line: number
}

/**
 * Put the caret on a line, opening the file it's in if necessary.
 *
 * A line number only means something in the LaTeX source, so a jump into a
 * file switches to that view. In the rich editor there are no lines at all,
 * which is why `jumpToSectionIndex` exists alongside this.
 */
export async function jumpToLine(target: JumpTarget): Promise<void> {
  const store = usePaperStore.getState()
  // Only switch to a file the paper actually reaches. A log can name a
  // class file or a package deep in the TeX tree, and opening one of those
  // would blank the editor rather than take you anywhere useful.
  const known = store.files.some((f) => f.path === target.file)
  if (target.file && known && target.file !== store.activeFile) {
    await store.openFile(target.file)
  }
  useUiStore.getState().setViewMode('source')

  // The view may have only just been asked to mount, or to swap documents.
  // Retry across a couple of frames rather than landing on the old document.
  for (let attempt = 0; attempt < 12; attempt++) {
    const view = getActiveSourceView()
    if (view && view.state.doc.lines > target.line) {
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, target.line + 1)))
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
      view.focus()
      return
    }
    await nextFrame()
  }
}

/**
 * Scroll the rich editor to its nth `\section`.
 *
 * The rich view has no line numbers to jump to, but the outline is a list of
 * section nodes in document order, so the index is the one thing both views
 * agree on.
 */
export function jumpToSectionIndex(index: number): boolean {
  const view = getActiveEditorView()
  if (!view) return false
  let seen = -1
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name !== 'section') return true
    seen++
    if (seen === index) {
      found = pos
      return false
    }
    return true
  })
  if (found < 0) return false
  const tr = view.state.tr
  // Into the title, which is the section's first child.
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found + 2, tr.doc.content.size))))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
