import { create } from 'zustand'
import {
  DEFAULT_FIND_OPTIONS,
  NO_MATCHES,
  type FindOptions,
  type MatchSummary
} from '../editor/source/search-model'

// What the find widget is looking for, kept outside the widget.
//
// Two reasons it isn't component state. The query has to survive the widget
// closing — you close find, read the paragraph, press Ctrl+F, and the thing
// you were looking for is still there. And the minimap paints a tick for
// every hit, which means something other than the widget needs to know where
// they are.

const OPTIONS_KEY = 'find.options.v1'

function readOptions(): FindOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    if (!raw) return DEFAULT_FIND_OPTIONS
    const parsed = JSON.parse(raw) as Partial<FindOptions>
    return {
      caseSensitive: parsed.caseSensitive === true,
      regexp: parsed.regexp === true,
      wholeWord: parsed.wholeWord === true
    }
  } catch {
    return DEFAULT_FIND_OPTIONS
  }
}

interface FindState {
  query: string
  replace: string
  options: FindOptions
  /** Recomputed by the widget whenever the query or the document changes. */
  summary: MatchSummary
  setQuery: (query: string) => void
  setReplace: (replace: string) => void
  toggleOption: (key: keyof FindOptions) => void
  setSummary: (summary: MatchSummary) => void
}

export const useFindStore = create<FindState>()((set) => ({
  query: '',
  replace: '',
  options: readOptions(),
  summary: NO_MATCHES,

  setQuery: (query) => set({ query }),
  setReplace: (replace) => set({ replace }),
  toggleOption: (key) =>
    set((state) => {
      const options = { ...state.options, [key]: !state.options[key] }
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
      return { options }
    }),
  setSummary: (summary) => set({ summary })
}))
