import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { FileText, Hash, ListTree, PanelRightClose, TriangleAlert } from 'lucide-react'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import { extractSections, type SectionEntry } from '../editor/sections'
import { getActiveSourceView, subscribeSourceUpdate } from '../editor/source/source-bridge'
import { jumpToSectionIndex } from '../editor/navigate'

// The paper's shape, kept on screen.
//
// There was a jump list already, but it lived in the command palette: you
// pressed a chord, read the list, picked one, and it was gone. That is a
// search box, not an outline — it can't tell you where you are, and it can't
// be glanced at. The minimap does that job for the source view and the rich
// view had nothing at all.
//
// It also lists the files, because a paper split across `\input`s has a
// second axis of structure and nowhere else surfaces it.

export function OutlinePanel(): React.JSX.Element | null {
  const open = useUiStore((s) => s.outlineOpen)
  const toggle = useUiStore((s) => s.toggleOutline)
  const viewMode = useUiStore((s) => s.viewMode)
  const tex = usePaperStore((s) => s.tex)
  const files = usePaperStore((s) => s.files)
  const activeFile = usePaperStore((s) => s.activeFile)
  const openFile = usePaperStore((s) => s.openFile)

  const sections = useMemo(() => extractSections(tex), [tex])
  const activeIndex = useCurrentSectionIndex(sections, open && viewMode === 'source')

  if (!open) return null

  const jump = (entry: SectionEntry, index: number): void => {
    if (viewMode === 'source') {
      const view = getActiveSourceView()
      if (!view) return
      const line = view.state.doc.line(Math.min(entry.line + 1, view.state.doc.lines))
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
      view.focus()
      return
    }
    // The rich view has no lines; the nth heading in the outline is the nth
    // `section` node in the document, which is what both views agree on.
    jumpToSectionIndex(index)
  }

  return (
    <aside className="outline-panel" aria-label="Document outline">
      <div className="outline-panel__header">
        <span className="outline-panel__heading">
          <ListTree size={13} strokeWidth={1.75} />
          Outline
        </span>
        <button
          className="outline-panel__close"
          title="Hide outline"
          aria-label="Hide outline"
          onClick={toggle}
        >
          <PanelRightClose size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="outline-panel__scroll">
        {files.length > 1 && (
          <div className="outline-panel__group">
            <div className="outline-panel__group-heading">Files</div>
            {files.map((file) => (
              <button
                key={file.path}
                className={
                  'outline-panel__file' +
                  (file.path === activeFile ? ' outline-panel__file--active' : '') +
                  (file.missing ? ' outline-panel__file--missing' : '')
                }
                style={{ paddingLeft: `${8 + file.depth * 12}px` }}
                title={
                  file.missing ? `${file.path} — \\input names it, but it isn’t there` : file.path
                }
                disabled={file.missing}
                onClick={() => void openFile(file.path)}
              >
                {file.missing ? <TriangleAlert size={12} /> : <FileText size={12} />}
                <span className="outline-panel__file-name">{basename(file.path)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="outline-panel__group">
          {files.length > 1 && (
            <div className="outline-panel__group-heading">{basename(activeFile)}</div>
          )}
          {sections.length === 0 ? (
            <p className="outline-panel__empty">
              No headings yet. A <code>\section</code> will show up here.
            </p>
          ) : (
            sections.map((entry, index) => (
              <button
                key={`${entry.line}-${index}`}
                className={
                  'outline-panel__item' +
                  (index === activeIndex ? ' outline-panel__item--active' : '') +
                  (entry.starred ? ' outline-panel__item--starred' : '')
                }
                style={{ paddingLeft: `${8 + entry.depth * 13}px` }}
                title={entry.title}
                onClick={() => jump(entry, index)}
              >
                <Hash size={11} className="outline-panel__item-icon" />
                <span className="outline-panel__item-title">{entry.title || '(untitled)'}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}

/**
 * Which heading the caret is under, so the outline can say where you are.
 *
 * Only meaningful in the source view — the caret has a line number there.
 * Subscribed to the editor's own update stream rather than polled, and it
 * only re-renders when the answer changes.
 */
function useCurrentSectionIndex(sections: SectionEntry[], enabled: boolean): number {
  const [index, setIndex] = useState(-1)

  useEffect(() => {
    if (!enabled) {
      setIndex(-1)
      return undefined
    }
    const recompute = (): void => {
      const view = getActiveSourceView()
      if (!view) return
      const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1
      let best = -1
      for (let i = 0; i < sections.length; i++) {
        if (sections[i].line > line) break
        best = i
      }
      setIndex((current) => (current === best ? current : best))
    }
    recompute()
    return subscribeSourceUpdate(recompute)
  }, [sections, enabled])

  return index
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
