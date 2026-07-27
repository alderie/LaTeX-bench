import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getSearchQuery, search, setSearchQuery } from '@codemirror/search'
import { searchHighlight } from '@renderer/editor/source/search-highlight'
import { buildQuery, emptyQuery } from '@renderer/editor/source/search-model'
import { readSourcePosition, writeSourcePosition } from '@renderer/editor/source/source-position'

// The point of the rewrite: highlighting that does not depend on
// CodeMirror's own search *panel* being open. The built-in highlighter bails
// unless the panel exists, which is why the app had to grow a second find bar
// and why Ctrl+F used to open two of them.

const PLAIN = { caseSensitive: false, regexp: false, wholeWord: false }

let view: EditorView | null = null

function mount(doc: string): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [search({ literal: false }), searchHighlight]
    }),
    parent: host
  })
  return view
}

afterEach(() => {
  view?.destroy()
  view = null
  document.body.innerHTML = ''
})

describe('search highlighting without a panel', () => {
  it('paints every match once a query is set', () => {
    const editor = mount('alpha beta\nalpha gamma')
    expect(editor.dom.querySelectorAll('.cm-searchMatch')).toHaveLength(0)

    editor.dispatch({
      effects: setSearchQuery.of(buildQuery('alpha', '', PLAIN))
    })
    expect(editor.dom.querySelectorAll('.cm-searchMatch')).toHaveLength(2)
  })

  it('never opens the search panel that CodeMirror ships', () => {
    const editor = mount('alpha beta')
    editor.dispatch({
      effects: setSearchQuery.of(buildQuery('alpha', '', PLAIN))
    })
    // The one find widget in the app is React's. If this ever finds a panel,
    // the user is looking at two find bars again.
    expect(editor.dom.querySelectorAll('.cm-panel')).toHaveLength(0)
  })

  it('marks the match the selection is sitting on', () => {
    const editor = mount('alpha beta alpha')
    editor.dispatch({
      effects: setSearchQuery.of(buildQuery('alpha', '', PLAIN)),
      selection: { anchor: 11, head: 16 }
    })
    const selected = editor.dom.querySelectorAll('.cm-searchMatch-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0].textContent).toBe('alpha')
  })

  it('clears when the query is emptied — closing find leaves no residue', () => {
    const editor = mount('alpha beta')
    editor.dispatch({
      effects: setSearchQuery.of(buildQuery('alpha', '', PLAIN))
    })
    expect(editor.dom.querySelectorAll('.cm-searchMatch')).toHaveLength(1)

    editor.dispatch({ effects: setSearchQuery.of(emptyQuery()) })
    expect(editor.dom.querySelectorAll('.cm-searchMatch')).toHaveLength(0)
  })

  it('paints nothing for a regex that does not compile', () => {
    const editor = mount('alpha beta')
    editor.dispatch({
      effects: setSearchQuery.of(buildQuery('foo(', '', { ...PLAIN, regexp: true }))
    })
    expect(editor.dom.querySelectorAll('.cm-searchMatch')).toHaveLength(0)
  })

  it('keeps the query the commands will read in sync with what is painted', () => {
    const editor = mount('alpha')
    editor.dispatch({
      effects: setSearchQuery.of(buildQuery('alpha', 'omega', PLAIN))
    })
    const query = getSearchQuery(editor.state)
    expect(query.search).toBe('alpha')
    expect(query.replace).toBe('omega')
  })
})

describe('remembered caret position', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a position for a paper', () => {
    writeSourcePosition('paper-1', { anchor: 120, head: 140 })
    expect(readSourcePosition('paper-1')).toEqual({ anchor: 120, head: 140 })
  })

  it('has nothing to say about a paper it has not seen', () => {
    expect(readSourcePosition('unknown')).toBeNull()
  })

  it('ignores a corrupted entry instead of throwing on open', () => {
    localStorage.setItem('source.pos.v1.paper-2', '{not json')
    expect(readSourcePosition('paper-2')).toBeNull()
    localStorage.setItem('source.pos.v1.paper-3', '{"anchor":"x"}')
    expect(readSourcePosition('paper-3')).toBeNull()
    localStorage.setItem('source.pos.v1.paper-4', '{"anchor":-5,"head":-5}')
    expect(readSourcePosition('paper-4')).toBeNull()
  })

  it('stays bounded as papers come and go', () => {
    for (let i = 0; i < 80; i++) writeSourcePosition(`paper-${i}`, { anchor: i, head: i })
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('source.pos.v1.'))
    expect(keys.length).toBeLessThanOrEqual(60)
  })
})
