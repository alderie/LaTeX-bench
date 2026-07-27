import * as React from 'react'
import {
  Bold,
  Italic,
  Code,
  Underline,
  Superscript,
  Subscript,
  List,
  ListOrdered,
  Sigma,
  SquareSigma,
  Plus,
  Minus,
  RotateCcw,
  Undo2,
  Redo2
} from 'lucide-react'
import { undo, redo } from 'prosemirror-history'
import { useUiStore } from '../stores/uiStore'
import {
  getActiveEditorView,
  insertDisplayMath,
  insertInlineMath,
  insertList,
  openInsertMenu,
  toggleEditorMark,
  useEditorSelection
} from '../editor/wysiwyg/editor-bridge'

// A compact formatting bar under the app header.
//
// Deliberately small: this is a LaTeX editor, so the toolbar is a reminder of
// what's available and a mouse path for the things worth clicking, not the
// primary interface. Anything structural (equations, tables, theorems,
// citations) lives behind the `/` menu, which is faster to reach while
// typing — the bar's "Insert" button just opens it for discoverability.

interface MarkButton {
  name: string
  title: string
  Icon: typeof Bold
}

const MARK_BUTTONS: MarkButton[] = [
  { name: 'strong', title: 'Bold  (\\textbf)', Icon: Bold },
  { name: 'em', title: 'Italic  (\\emph)', Icon: Italic },
  { name: 'code', title: 'Monospace  (\\texttt)', Icon: Code },
  { name: 'underline', title: 'Underline  (\\underline)', Icon: Underline },
  { name: 'superscript', title: 'Superscript  (\\textsuperscript)', Icon: Superscript },
  { name: 'subscript', title: 'Subscript  (\\textsubscript)', Icon: Subscript }
]

function ToolbarButton({
  title,
  active,
  disabled,
  onClick,
  children
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`editor-toolbar__button${active ? ' editor-toolbar__button--active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // The editor must keep focus and its selection: a plain click would
      // blur it first, so the command would apply to nothing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function EditorToolbar(): React.JSX.Element | null {
  const viewMode = useUiStore((s) => s.viewMode)
  const zoom = useUiStore((s) => s.zoom)
  const stepZoom = useUiStore((s) => s.stepZoom)
  const resetZoom = useUiStore((s) => s.resetZoom)
  const { marks, ready } = useEditorSelection()

  // The formatting half only makes sense against the rich editor; source
  // mode has CodeMirror's own keybindings.
  const rich = viewMode === 'wysiwyg'

  const runHistory = (which: 'undo' | 'redo') => (): void => {
    const view = getActiveEditorView()
    if (!view) return
    ;(which === 'undo' ? undo : redo)(view.state, view.dispatch)
    view.focus()
  }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      {rich && (
        <>
          <div className="editor-toolbar__group">
            {MARK_BUTTONS.map(({ name, title, Icon }) => (
              <ToolbarButton
                key={name}
                title={title}
                active={marks.includes(name)}
                disabled={!ready}
                onClick={() => toggleEditorMark(name)}
              >
                <Icon size={14} />
              </ToolbarButton>
            ))}
          </div>

          <div className="editor-toolbar__divider" />

          <div className="editor-toolbar__group">
            <ToolbarButton title="Inline formula  ($…$)" disabled={!ready} onClick={insertInlineMath}>
              <Sigma size={14} />
            </ToolbarButton>
            <ToolbarButton
              title="Display equation"
              disabled={!ready}
              onClick={insertDisplayMath}
            >
              <SquareSigma size={14} />
            </ToolbarButton>
            <ToolbarButton
              title="Bulleted list  (itemize)"
              disabled={!ready}
              onClick={() => insertList('itemize')}
            >
              <List size={14} />
            </ToolbarButton>
            <ToolbarButton
              title="Numbered list  (enumerate)"
              disabled={!ready}
              onClick={() => insertList('enumerate')}
            >
              <ListOrdered size={14} />
            </ToolbarButton>
            <ToolbarButton
              title="Insert…  (or type / in the document)"
              disabled={!ready}
              onClick={openInsertMenu}
            >
              <Plus size={14} />
            </ToolbarButton>
          </div>

          <div className="editor-toolbar__divider" />

          <div className="editor-toolbar__group">
            <ToolbarButton title="Undo  (Ctrl/Cmd Z)" disabled={!ready} onClick={runHistory('undo')}>
              <Undo2 size={14} />
            </ToolbarButton>
            <ToolbarButton
              title="Redo  (Ctrl/Cmd Shift Z)"
              disabled={!ready}
              onClick={runHistory('redo')}
            >
              <Redo2 size={14} />
            </ToolbarButton>
          </div>
        </>
      )}

      <div className="editor-toolbar__spacer" />

      <div className="editor-toolbar__group">
        <ToolbarButton title="Zoom out  (Ctrl/Cmd −)" onClick={() => stepZoom(-1)}>
          <Minus size={14} />
        </ToolbarButton>
        {/* Doubles as the reset control: the percentage is the obvious place
            to click when you want to get back to 100%. */}
        <button
          type="button"
          className="editor-toolbar__zoom"
          title="Reset zoom to 100%  (Ctrl/Cmd 0)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={resetZoom}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton title="Zoom in  (Ctrl/Cmd +)" onClick={() => stepZoom(1)}>
          <Plus size={14} />
        </ToolbarButton>
        <ToolbarButton title="Reset zoom  (Ctrl/Cmd 0)" onClick={resetZoom}>
          <RotateCcw size={14} />
        </ToolbarButton>
      </div>
    </div>
  )
}
