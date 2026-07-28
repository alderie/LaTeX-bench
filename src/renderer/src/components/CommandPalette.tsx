import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import {
  Hash,
  FilePlus2,
  FileText,
  Play,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Replace,
  Map as MapIcon,
  ChevronsDownUp,
  ChevronsUpDown,
  FileWarning,
  ListTree,
  PanelRight
} from 'lucide-react'
import { unfoldAll } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { useUiStore } from '../stores/uiStore'
import { useLibraryStore } from '../stores/libraryStore'
import { usePaperStore } from '../stores/paperStore'
import { extractSections, type SectionEntry } from '../editor/sections'
import { getActiveSourceView } from '../editor/source/source-bridge'
import { foldToLevel } from '../editor/source/fold-commands'
import { jumpToSectionIndex } from '../editor/navigate'

const CommandRoot = Command as any
const CommandInputC = (Command as any).Input
const CommandListC = (Command as any).List
const CommandItemC = (Command as any).Item
const CommandGroupC = (Command as any).Group
const CommandEmptyC = (Command as any).Empty

interface SectionItem extends SectionEntry {
  id: string
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useUiStore((s) => s.paletteOpen)
  const setOpen = useUiStore((s) => s.setPaletteOpen)
  const tex = usePaperStore((s) => s.tex)
  const paperId = usePaperStore((s) => s.paperId)
  const papers = useLibraryStore((s) => s.papers)
  const selectPaper = useLibraryStore((s) => s.selectPaper)
  const createPaper = useLibraryStore((s) => s.createPaper)

  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const sections = useMemo<SectionItem[]>(
    () => extractSections(tex).map((s, i) => ({ ...s, id: `${s.line}-${i}` })),
    [tex]
  )

  if (!open) return null

  const close = (): void => setOpen(false)

  const jumpToSection = (s: SectionItem, index: number): void => {
    close()
    // In the source view, move the actual caret. The previous version
    // counted `.cm-line` elements in the DOM, which only works for sections
    // that happen to be on screen already — CodeMirror renders the viewport,
    // not the document, so jumping to section 14 of a long paper landed
    // somewhere arbitrary or nowhere at all.
    const view = getActiveSourceView()
    if (view) {
      const line = view.state.doc.line(Math.min(s.line + 1, view.state.doc.lines))
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
      view.focus()
      return
    }
    // The rich view has no lines — the nth entry in the outline is the nth
    // `section` node, which is the index both views share.
    jumpToSectionIndex(index)
  }

  /** Run a CodeMirror command from the palette, if the source view is up. */
  const runInSource = (command: (view: EditorView) => boolean): void => {
    close()
    const view = getActiveSourceView()
    if (!view) return
    command(view)
    view.focus()
  }

  const handleNewPaper = async (): Promise<void> => {
    close()
    await createPaper('Untitled paper')
  }

  const handleBuild = async (): Promise<void> => {
    close()
    if (!paperId) return
    usePaperStore.getState().setBuildState({ state: 'running', errors: [], log: '' })
    await window.latexAPI.build(paperId)
  }

  return (
    <div className="command-palette__backdrop" onClick={close}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <CommandRoot label="Command palette" loop>
          <CommandInputC
            value={query}
            onValueChange={setQuery}
            placeholder="Jump to section, switch paper, run command…"
            className="command-palette__input"
            autoFocus
          />
          <CommandListC className="command-palette__list">
            <CommandEmptyC className="command-palette__empty">No results.</CommandEmptyC>

            {sections.length > 0 && (
              <CommandGroupC heading="Sections" className="command-palette__group">
                {sections.map((s, index) => (
                  <CommandItemC
                    key={s.id}
                    value={`section ${s.title}`}
                    onSelect={() => jumpToSection(s, index)}
                    className="command-palette__item"
                  >
                    <Hash size={14} />
                    <span style={{ paddingLeft: `${s.depth * 12}px` }}>{s.title}</span>
                  </CommandItemC>
                ))}
              </CommandGroupC>
            )}

            <CommandGroupC heading="Papers" className="command-palette__group">
              {papers.map((p) => (
                <CommandItemC
                  key={p.id}
                  value={`paper ${p.title}`}
                  onSelect={() => {
                    close()
                    selectPaper(p.id)
                  }}
                  className="command-palette__item"
                >
                  <FileText size={14} />
                  <span>{p.title}</span>
                </CommandItemC>
              ))}
            </CommandGroupC>

            <CommandGroupC heading="Editor" className="command-palette__group">
              <CommandItemC
                value="find search"
                onSelect={() => {
                  close()
                  useUiStore.getState().openFind()
                }}
                className="command-palette__item"
              >
                <Search size={14} />
                <span>Find</span>
                <span className="command-palette__shortcut">Ctrl/Cmd F</span>
              </CommandItemC>
              <CommandItemC
                value="replace substitute find and replace"
                onSelect={() => {
                  close()
                  useUiStore.getState().openFind(true)
                }}
                className="command-palette__item"
              >
                <Replace size={14} />
                <span>Replace</span>
                <span className="command-palette__shortcut">Ctrl/Cmd H</span>
              </CommandItemC>
              <CommandItemC
                value="fold collapse sections outline"
                onSelect={() => runInSource(foldToLevel(1))}
                className="command-palette__item"
              >
                <ChevronsDownUp size={14} />
                <span>Collapse to section headings</span>
                <span className="command-palette__shortcut">Ctrl/Cmd K 1</span>
              </CommandItemC>
              <CommandItemC
                value="unfold expand all sections"
                onSelect={() => runInSource(unfoldAll)}
                className="command-palette__item"
              >
                <ChevronsUpDown size={14} />
                <span>Expand everything</span>
                <span className="command-palette__shortcut">Ctrl/Cmd K J</span>
              </CommandItemC>
              <CommandItemC
                value="minimap toggle overview"
                onSelect={() => {
                  close()
                  useUiStore.getState().toggleMinimap()
                }}
                className="command-palette__item"
              >
                <MapIcon size={14} />
                <span>Toggle minimap</span>
              </CommandItemC>
              <CommandItemC
                value="outline toggle sections panel contents"
                onSelect={() => {
                  close()
                  useUiStore.getState().toggleOutline()
                }}
                className="command-palette__item"
              >
                <ListTree size={14} />
                <span>Toggle outline</span>
              </CommandItemC>
            </CommandGroupC>

            <CommandGroupC heading="View" className="command-palette__group">
              <CommandItemC
                value="pdf preview toggle output compiled document"
                onSelect={() => {
                  close()
                  useUiStore.getState().togglePreview()
                }}
                className="command-palette__item"
              >
                <PanelRight size={14} />
                <span>Toggle PDF preview</span>
              </CommandItemC>
              <CommandItemC
                value="build results problems errors log output"
                onSelect={() => {
                  close()
                  useUiStore.getState().toggleBuildPanel()
                }}
                className="command-palette__item"
              >
                <FileWarning size={14} />
                <span>Toggle build results</span>
              </CommandItemC>
              <CommandItemC
                value="reset zoom 100% actual size"
                onSelect={() => {
                  close()
                  useUiStore.getState().resetZoom()
                }}
                className="command-palette__item"
              >
                <RotateCcw size={14} />
                <span>Reset zoom to 100%</span>
                <span className="command-palette__shortcut">Ctrl/Cmd 0</span>
              </CommandItemC>
              <CommandItemC
                value="zoom in larger text bigger"
                onSelect={() => {
                  close()
                  useUiStore.getState().stepZoom(1)
                }}
                className="command-palette__item"
              >
                <ZoomIn size={14} />
                <span>Zoom in</span>
                <span className="command-palette__shortcut">Ctrl/Cmd +</span>
              </CommandItemC>
              <CommandItemC
                value="zoom out smaller text"
                onSelect={() => {
                  close()
                  useUiStore.getState().stepZoom(-1)
                }}
                className="command-palette__item"
              >
                <ZoomOut size={14} />
                <span>Zoom out</span>
                <span className="command-palette__shortcut">Ctrl/Cmd −</span>
              </CommandItemC>
            </CommandGroupC>

            <CommandGroupC heading="Actions" className="command-palette__group">
              <CommandItemC
                value="new paper create"
                onSelect={handleNewPaper}
                className="command-palette__item"
              >
                <FilePlus2 size={14} />
                <span>Create new paper</span>
              </CommandItemC>
              <CommandItemC
                value="build compile pdf"
                onSelect={handleBuild}
                className="command-palette__item"
              >
                <Play size={14} />
                <span>Build PDF</span>
              </CommandItemC>
            </CommandGroupC>
          </CommandListC>
        </CommandRoot>
        <button
          className="command-palette__esc"
          onClick={close}
          title="Close (Esc)"
          aria-label="Close palette"
        >
          esc
        </button>
      </div>
    </div>
  )
}
