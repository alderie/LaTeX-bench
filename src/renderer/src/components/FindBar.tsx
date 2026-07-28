import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X
} from 'lucide-react'
import { setSearchQuery, findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search'
import { useUiStore } from '../stores/uiStore'
import { useFindStore } from '../stores/findStore'
import {
  buildQuery,
  describeMatches,
  emptyQuery,
  summarizeMatches,
  NO_MATCHES,
  type FindOptions
} from '../editor/source/search-model'
import {
  getActiveSourceView,
  subscribeSourceUpdate,
  subscribeSourceView
} from '../editor/source/source-bridge'
import { getActiveEditorView, subscribeEditorUpdate } from '../editor/wysiwyg/editor-bridge'
import {
  richClear,
  richReplace,
  richReplaceAll,
  richSearch,
  richStep,
  richSummary
} from '../editor/wysiwyg/find-replace'

// Find and replace, in the shape everyone already knows.
//
// This used to be two widgets fighting each other: a hand-rolled bar on
// `window.find`, and CodeMirror's own search panel — both bound to Ctrl+F, so
// the key opened both, stacked, neither of them the one you meant. There is
// one widget now, and it drives whichever editor is up.
//
// In the source view that is CodeMirror's own search state, so regex,
// whole-word, case, and `$1` group replacement are the real implementations
// rather than an approximation. In the rich view it is a search over the
// ProseMirror document — which is the part that used to be missing. The
// fallback there was `window.find`: no replace, no count, and blind to
// anything not painted, which is to say blind to the preamble, to every
// formula's LaTeX, and to any block that wasn't open. Both halves now offer
// the same operations, so the widget no longer has to apologise for one of
// them.

const TOGGLES: Array<{
  key: keyof FindOptions
  title: string
  Icon: typeof CaseSensitive
}> = [
  { key: 'caseSensitive', title: 'Match case  (Alt+C)', Icon: CaseSensitive },
  { key: 'wholeWord', title: 'Match whole word  (Alt+W)', Icon: WholeWord },
  { key: 'regexp', title: 'Use regular expression  (Alt+R)', Icon: Regex }
]

export function FindBar(): React.JSX.Element | null {
  const open = useUiStore((s) => s.findBarOpen)
  const replaceOpen = useUiStore((s) => s.findReplaceOpen)
  const request = useUiStore((s) => s.findRequest)
  const closeFind = useUiStore((s) => s.closeFind)
  const toggleReplaceRow = useUiStore((s) => s.toggleFindReplace)

  const query = useFindStore((s) => s.query)
  const replaceWith = useFindStore((s) => s.replace)
  const options = useFindStore((s) => s.options)
  const summary = useFindStore((s) => s.summary)
  const setQuery = useFindStore((s) => s.setQuery)
  const setReplaceValue = useFindStore((s) => s.setReplace)
  const toggleOption = useFindStore((s) => s.toggleOption)
  const setSummary = useFindStore((s) => s.setSummary)

  const findInput = useRef<HTMLInputElement | null>(null)
  const replaceInput = useRef<HTMLInputElement | null>(null)

  // Which editor is up. Both can search and replace now; the difference is
  // only which implementation the widget talks to.
  const hasSource = useSourceViewPresent()

  /**
   * Push the current query into the active editor and recount.
   *
   * One function for both because they must not diverge: the highlighter and
   * the "3 of 17" read the same query object, so a count can never describe a
   * different search than the one painted on the page.
   */
  const apply = useCallback(
    (nextQuery: string, nextReplace: string, nextOptions: FindOptions): void => {
      const view = getActiveSourceView()
      if (view) {
        const search = buildQuery(nextQuery, nextReplace, nextOptions)
        view.dispatch({ effects: setSearchQuery.of(search) })
        const { main } = view.state.selection
        setSummary(summarizeMatches(view.state, search, main.from, main.to))
        return
      }
      const rich = getActiveEditorView()
      if (!rich) {
        setSummary(NO_MATCHES)
        return
      }
      setSummary(richSearch(rich, nextQuery, nextOptions))
    },
    [setSummary]
  )

  // Re-apply whenever the query, the replacement, or a toggle changes —
  // and when the view flips under an open widget, since that swaps which
  // editor the query has to be pushed into.
  useEffect(() => {
    if (!open) return
    apply(query, replaceWith, options)
  }, [open, query, replaceWith, options, hasSource, apply])

  // …and recount when the document or selection moves under us, so the
  // position advances as you step through matches and the total drops as you
  // replace them.
  useEffect(() => {
    if (!open) return undefined
    const fromSource = subscribeSourceUpdate(() => {
      const view = getActiveSourceView()
      if (!view) return
      const search = buildQuery(
        useFindStore.getState().query,
        useFindStore.getState().replace,
        useFindStore.getState().options
      )
      const { main } = view.state.selection
      setSummary(summarizeMatches(view.state, search, main.from, main.to))
    })
    const fromRich = subscribeEditorUpdate(() => {
      if (getActiveSourceView()) return
      const rich = getActiveEditorView()
      if (!rich) return
      setSummary(richSummary(rich))
    })
    return () => {
      fromSource()
      fromRich()
    }
  }, [open, setSummary])

  // Opening seeds from the selection, the way every editor does: select a
  // word, press Ctrl+F, and it is already the query.
  useEffect(() => {
    if (!open) return
    const view = getActiveSourceView()
    const rich = getActiveEditorView()
    let selected = ''
    if (view) {
      selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
    } else if (rich) {
      const { from, to } = rich.state.selection
      selected = from === to ? '' : rich.state.doc.textBetween(from, to, ' ', ' ')
    }
    if (selected && selected.length <= 200 && !selected.includes('\n')) {
      useFindStore.getState().setQuery(selected)
    }
    const input = findInput.current
    input?.focus()
    input?.select()
  }, [open, request])

  // Closing clears the highlighting and hands focus back to the text.
  useEffect(() => {
    if (open) return
    const view = getActiveSourceView()
    if (view) {
      view.dispatch({ effects: setSearchQuery.of(emptyQuery()) })
      return
    }
    const rich = getActiveEditorView()
    if (rich) richClear(rich)
  }, [open])

  const close = useCallback((): void => {
    closeFind()
    const view = getActiveSourceView()
    if (view) view.focus()
    else getActiveEditorView()?.focus()
  }, [closeFind])

  const step = useCallback(
    (backwards: boolean): void => {
      if (!query) return
      const view = getActiveSourceView()
      if (view) {
        ;(backwards ? findPrevious : findNext)(view)
        return
      }
      const rich = getActiveEditorView()
      if (rich) setSummary(richStep(rich, backwards))
    },
    [query, setSummary]
  )

  const doReplace = useCallback(
    (all: boolean): void => {
      if (!query) return
      const view = getActiveSourceView()
      if (view) {
        ;(all ? replaceAll : replaceNext)(view)
        return
      }
      const rich = getActiveEditorView()
      if (!rich) return
      setSummary(
        all
          ? richReplaceAll(rich, useFindStore.getState().replace)
          : richReplace(rich, useFindStore.getState().replace)
      )
    },
    [query, setSummary]
  )

  /** Alt+C / Alt+W / Alt+R, from either field. VS Code's bindings. */
  const optionShortcut = (event: React.KeyboardEvent): boolean => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return false
    const key = event.key.toLowerCase()
    const map: Record<string, keyof FindOptions> = {
      c: 'caseSensitive',
      w: 'wholeWord',
      r: 'regexp'
    }
    const option = map[key]
    if (!option) return false
    event.preventDefault()
    toggleOption(option)
    return true
  }

  if (!open) return null

  const label = describeMatches(summary, query.length > 0)
  const noResults = query.length > 0 && summary.count === 0 && !summary.error

  return (
    <div
      className={'find-widget' + (replaceOpen ? ' find-widget--replace' : '')}
      role="search"
      aria-label="Find and replace"
    >
      <button
        className="find-widget__expand"
        title={replaceOpen ? 'Hide replace' : 'Show replace  (Ctrl+H)'}
        aria-expanded={replaceOpen}
        onClick={toggleReplaceRow}
      >
        {replaceOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      <div className="find-widget__rows">
        <div className="find-widget__row">
          <div
            className={
              'find-widget__field' +
              (summary.error ? ' find-widget__field--error' : '') +
              (noResults ? ' find-widget__field--empty' : '')
            }
          >
            <input
              ref={findInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find"
              aria-label="Find"
              spellCheck={false}
              className="find-widget__input"
              onKeyDown={(e) => {
                if (optionShortcut(e)) return
                if (e.key === 'Escape') {
                  e.preventDefault()
                  close()
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  step(e.shiftKey)
                }
              }}
            />
            {TOGGLES.map(({ key, title, Icon }) => (
              <button
                key={key}
                type="button"
                className={'find-widget__toggle' + (options[key] ? ' find-widget__toggle--on' : '')}
                title={title}
                aria-label={title}
                aria-pressed={options[key]}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleOption(key)}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>

          {/* Short enough to fit next to the field; the reason a regex
              won't compile is longer than that, so it goes in the title. */}
          <span
            className={'find-widget__count' + (summary.error ? ' find-widget__count--error' : '')}
            title={summary.error ?? undefined}
            aria-live="polite"
          >
            {label}
          </span>

          <button
            className="find-widget__button"
            title="Previous match  (Shift+Enter)"
            aria-label="Previous match"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(true)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="find-widget__button"
            title="Next match  (Enter)"
            aria-label="Next match"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(false)}
          >
            <ArrowDown size={14} />
          </button>
          <button
            className="find-widget__button"
            title="Close  (Esc)"
            aria-label="Close find"
            onClick={close}
          >
            <X size={14} />
          </button>
        </div>

        {replaceOpen && (
          <div className="find-widget__row">
            <div className="find-widget__field">
              <input
                ref={replaceInput}
                value={replaceWith}
                onChange={(e) => setReplaceValue(e.target.value)}
                placeholder={options.regexp ? 'Replace  ($1 for groups)' : 'Replace'}
                aria-label="Replace"
                spellCheck={false}
                className="find-widget__input"
                onKeyDown={(e) => {
                  if (optionShortcut(e)) return
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    close()
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    doReplace(e.ctrlKey || e.metaKey || e.altKey)
                  }
                }}
              />
            </div>
            <button
              className="find-widget__button"
              title="Replace  (Enter)"
              aria-label="Replace"
              disabled={!query}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doReplace(false)}
            >
              <Replace size={14} />
            </button>
            <button
              className="find-widget__button"
              title="Replace all  (Ctrl+Enter)"
              aria-label="Replace all"
              disabled={!query}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doReplace(true)}
            >
              <ReplaceAll size={14} />
            </button>
            {/* The rich view searches the document, not the page, so it
                reaches into formulas and the preamble. Worth saying, because
                a match you can't see is otherwise a surprising one. */}
            {!hasSource && (
              <span className="find-widget__note">Includes formulas and the preamble</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** True while the source editor is mounted, re-rendering when that flips. */
function useSourceViewPresent(): boolean {
  return React.useSyncExternalStore(
    subscribeSourceView,
    () => getActiveSourceView() !== null,
    () => false
  )
}
