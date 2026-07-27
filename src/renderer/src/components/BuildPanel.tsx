import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  FileWarning,
  Loader2,
  ScrollText,
  XCircle
} from 'lucide-react'
import type { BuildError } from '@shared/types'
import { usePaperStore } from '../stores/paperStore'
import { useUiStore } from '../stores/uiStore'
import { jumpToLine } from '../editor/navigate'
import { TexInstallCard, useTexState } from './TexInstallCard'

// What the compiler said.
//
// The build already ran, already streamed its log, and already had its
// errors parsed into `build.errors` with file and line numbers — and none of
// it reached the screen. The only signal a build had failed was that the PDF
// didn't change, which in an editor that couldn't show the PDF either meant
// there was no signal at all.
//
// Two rules shape this. It opens itself when a build fails and stays out of
// the way otherwise, because an error list you have to go looking for is one
// you find out about too late. And every error with a line number is a link:
// the distance between "Undefined control sequence on line 412" and being on
// line 412 should be one click.

const MAX_LOG_CHARS = 40_000

function StateBadge({
  state,
  durationMs
}: {
  state: string
  durationMs: number
}): React.JSX.Element {
  if (state === 'running' || state === 'queued') {
    return (
      <span className="build-panel__state build-panel__state--running">
        <Loader2 size={13} strokeWidth={2.5} className="build-panel__spin" />
        {state === 'queued' ? 'Queued' : 'Compiling…'}
      </span>
    )
  }
  if (state === 'success') {
    return (
      <span className="build-panel__state build-panel__state--ok">
        <CheckCircle2 size={13} strokeWidth={2.5} />
        Compiled{durationMs > 0 ? ` in ${(durationMs / 1000).toFixed(1)}s` : ''}
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="build-panel__state build-panel__state--bad">
        <XCircle size={13} strokeWidth={2.5} />
        Build failed
      </span>
    )
  }
  return (
    <span className="build-panel__state build-panel__state--idle">
      <CircleSlash size={13} strokeWidth={2.5} />
      Not built yet
    </span>
  )
}

export function BuildPanel(): React.JSX.Element | null {
  const build = usePaperStore((s) => s.build)
  const paperId = usePaperStore((s) => s.paperId)
  const open = useUiStore((s) => s.buildPanelOpen)
  const toggle = useUiStore((s) => s.toggleBuildPanel)
  const setOpen = useUiStore((s) => s.setBuildPanelOpen)
  const [showLog, setShowLog] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  useTexState()

  const { errors, warnings } = useMemo(() => split(build.errors), [build.errors])

  // A failed build opens the panel. A successful one never closes it — if
  // you opened it to watch the log, it staying open is the point.
  const lastState = useRef(build.state)
  useEffect(() => {
    if (build.state === 'error' && lastState.current !== 'error') setOpen(true)
    lastState.current = build.state
  }, [build.state, setOpen])

  // Follow the tail while a build streams, the way a terminal does.
  useEffect(() => {
    if (!showLog || !open) return
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [build.log, showLog, open])

  if (!paperId) return null

  const summary =
    errors.length > 0 || warnings.length > 0
      ? [
          errors.length > 0 ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : '',
          warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''
        ]
          .filter(Boolean)
          .join(', ')
      : ''

  return (
    <div className={'build-panel' + (open ? ' build-panel--open' : '')}>
      <button
        className="build-panel__bar"
        onClick={toggle}
        aria-expanded={open}
        title={open ? 'Hide build results' : 'Show build results'}
      >
        <StateBadge state={build.state} durationMs={build.durationMs} />
        {summary && (
          <span className="build-panel__summary">
            {errors.length > 0 && (
              <span className="build-panel__count build-panel__count--error">
                <XCircle size={12} strokeWidth={2.5} />
                {errors.length}
              </span>
            )}
            {warnings.length > 0 && (
              <span className="build-panel__count build-panel__count--warning">
                <AlertTriangle size={12} strokeWidth={2.5} />
                {warnings.length}
              </span>
            )}
          </span>
        )}
        <span className="build-panel__spacer" />
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {open && (
        <div className="build-panel__body">
          <div className="build-panel__tabs">
            <button
              className={'build-panel__tab' + (!showLog ? ' build-panel__tab--active' : '')}
              onClick={() => setShowLog(false)}
            >
              <FileWarning size={12} />
              Problems
              {build.errors.length > 0 ? ` (${build.errors.length})` : ''}
            </button>
            <button
              className={'build-panel__tab' + (showLog ? ' build-panel__tab--active' : '')}
              onClick={() => setShowLog(true)}
            >
              <ScrollText size={12} />
              Log
            </button>
          </div>

          {/* Above the problem list, because when it shows at all it is the
              answer to every problem in that list. */}
          <TexInstallCard />

          {showLog ? (
            <pre className="build-panel__log" ref={logRef}>
              {build.log ? build.log.slice(-MAX_LOG_CHARS) : 'No output yet.'}
            </pre>
          ) : (
            <ProblemList errors={build.errors} />
          )}
        </div>
      )}
    </div>
  )
}

function ProblemList({ errors }: { errors: BuildError[] }): React.JSX.Element {
  if (errors.length === 0) {
    return (
      <div className="build-panel__empty">
        <CheckCircle2 size={16} strokeWidth={2.25} />
        <span>Nothing to report.</span>
      </div>
    )
  }
  return (
    <ul className="build-panel__list">
      {errors.map((error, index) => (
        <ProblemRow key={`${error.file ?? ''}:${error.line ?? ''}:${index}`} error={error} />
      ))}
    </ul>
  )
}

function ProblemRow({ error }: { error: BuildError }): React.JSX.Element {
  const locatable = typeof error.line === 'number'
  const where = error.file ? `${shortFile(error.file)}:${error.line}` : ''

  const go = (): void => {
    if (!locatable) return
    // Log lines are 1-based; the navigator takes a zero-based line.
    void jumpToLine({
      file: error.file ? shortFile(error.file) : undefined,
      line: error.line! - 1
    })
  }

  return (
    <li
      className={
        'build-panel__row' +
        (error.severity === 'warning' ? ' build-panel__row--warning' : '') +
        (locatable ? ' build-panel__row--locatable' : '')
      }
      role={locatable ? 'button' : undefined}
      tabIndex={locatable ? 0 : undefined}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      }}
      title={locatable ? `Go to ${where}` : undefined}
    >
      {/* Heavier than the default stroke: at 13px on a muted red these are
          a few dozen pixels of outline, and a hairline reads as a smudge
          rather than as a symbol. */}
      {error.severity === 'warning' ? (
        <AlertTriangle size={14} strokeWidth={2.5} className="build-panel__row-icon" />
      ) : (
        <XCircle size={14} strokeWidth={2.5} className="build-panel__row-icon" />
      )}
      <span className="build-panel__row-message">{error.message}</span>
      {where && <span className="build-panel__row-where">{where}</span>}
    </li>
  )
}

/** `./sections/method.tex` → `sections/method.tex`; absolute paths keep a tail. */
function shortFile(file: string): string {
  const normalised = file.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalised.split('/')
  return parts.length > 3 ? parts.slice(-3).join('/') : normalised
}

function split(errors: BuildError[]): {
  errors: BuildError[]
  warnings: BuildError[]
} {
  return {
    errors: errors.filter((e) => e.severity === 'error'),
    warnings: errors.filter((e) => e.severity === 'warning')
  }
}
