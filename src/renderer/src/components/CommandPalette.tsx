import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Hash, FilePlus2, FileText, Play } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { useLibraryStore } from '../stores/libraryStore'
import { usePaperStore } from '../stores/paperStore'
import { extractSections, type SectionEntry } from '../editor/sections'

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

  const jumpToSection = (s: SectionItem): void => {
    // Scroll the source editor's caret line — the editor reads paperStore.tex
    // by reference so we just nudge the caret. For WYSIWYG we just close
    // the palette; the section is already visible in the long doc.
    close()
    setTimeout(() => {
      const cm = document.querySelector('.cm-content') as HTMLElement | null
      if (!cm) return
      // Best-effort: find the line element and scroll to it.
      const lines = cm.querySelectorAll('.cm-line')
      const target = lines[s.line]
      if (target) (target as HTMLElement).scrollIntoView({ block: 'center' })
    }, 0)
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
                {sections.map((s) => (
                  <CommandItemC
                    key={s.id}
                    value={`section ${s.title}`}
                    onSelect={() => jumpToSection(s)}
                    className="command-palette__item"
                  >
                    <Hash size={14} />
                    <span style={{ paddingLeft: `${(s.level - 1) * 12}px` }}>{s.title}</span>
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
