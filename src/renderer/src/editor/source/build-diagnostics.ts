// The compiler's own errors, in the source view's gutter.
//
// The gutter already squiggled two synthetic checks — an unbalanced
// `\begin`, an odd `$` — while the real compiler's errors, already parsed
// into `build.errors` with file and line numbers, were rendered nowhere at
// all. This puts them where the two hand-written checks already were, which
// is the place you are looking when you find out something didn't compile.

import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { linter, type Diagnostic } from '@codemirror/lint'
import type { BuildError } from '@shared/types'

/** What the source view is showing, so we can drop other files' errors. */
export interface BuildDiagnosticsInput {
  errors: BuildError[]
  /** Paper-relative path of the file in the editor, e.g. `sections/method.tex`. */
  activeFile: string
}

const EMPTY: BuildDiagnosticsInput = { errors: [], activeFile: '' }

export const setBuildDiagnostics = StateEffect.define<BuildDiagnosticsInput>()

const buildDiagnosticsField = StateField.define<BuildDiagnosticsInput>({
  create: () => EMPTY,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBuildDiagnostics)) return effect.value
    }
    return value
  }
})

/**
 * Does a log's file reference name the file we're editing?
 *
 * TeX writes paths every way there is — `./main.tex`, `main.tex`, an
 * absolute path, sometimes with the extension missing — so this compares the
 * tail rather than trying to canonicalise both sides. An error with no file
 * at all is a global one (a missing package, a spawn failure); it belongs in
 * the panel, not on a line, so it is deliberately not placed here.
 */
export function errorBelongsTo(file: string | undefined, activeFile: string): boolean {
  if (!file || !activeFile) return false
  const normalise = (p: string): string =>
    p
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\.tex$/i, '')
      .toLowerCase()
  const a = normalise(file)
  const b = normalise(activeFile)
  if (a === b) return true
  // `/long/abs/path/sections/method` vs `sections/method`.
  return a.endsWith('/' + b) || b.endsWith('/' + a)
}

/** Turn build errors into diagnostics anchored on the lines they name. */
export function buildDiagnosticsFor(
  state: EditorState,
  input: BuildDiagnosticsInput
): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const error of input.errors) {
    if (typeof error.line !== 'number') continue
    if (!errorBelongsTo(error.file, input.activeFile)) continue
    // A log can name a line past the end of the file we currently hold —
    // the user has edited since the build. Clamp rather than drop: the
    // squiggle being one line off is better than the error vanishing.
    const number = Math.min(Math.max(1, error.line), state.doc.lines)
    const line = state.doc.line(number)
    out.push({
      from: line.from,
      to: line.to,
      severity: error.severity,
      source: 'LaTeX',
      message: error.message
    })
  }
  return out
}

/**
 * A second lint source alongside the syntax checks.
 *
 * `@codemirror/lint` merges every registered source, so this coexists with
 * `latexLinter` rather than replacing it — which is right, because they
 * answer different questions: one is "this will not compile", the other is
 * "this did not compile".
 */
export function buildDiagnostics(): Extension {
  return [
    buildDiagnosticsField,
    linter((view) => buildDiagnosticsFor(view.state, view.state.field(buildDiagnosticsField)), {
      // Build results arrive on their own schedule, not on a document
      // change, so the linter has to be told to look again.
      needsRefresh: (update) =>
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setBuildDiagnostics))
        )
    })
  ]
}
