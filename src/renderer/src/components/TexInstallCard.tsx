import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Package, Trash2 } from 'lucide-react'
import type { TexInstallProgress } from '@shared/types'
import { useTexStore } from '../stores/texStore'
import { usePaperStore } from '../stores/paperStore'

// Getting LaTeX, without going and getting LaTeX.
//
// The build panel can tell you that no engine was found. That is only half an
// answer: the other half used to be "go and install a four-gigabyte
// distribution, then come back". This is the other half.
//
// What it installs goes in one directory the app owns — nothing in
// /usr/local, nothing on your PATH, no administrator prompt — which is what
// makes the Remove button honest. It is the same directory the papers are in,
// so "get rid of this app and everything it downloaded" stays a matter of
// deleting one folder.
//
// All of it lives in one chip in the build panel's tab row. It used to be a
// card above the problem list — a title, a size, two buttons and a paragraph,
// permanently occupying two lines of the one panel in the app whose job is to
// show you what went wrong. The chip is the same four states in one line: no
// engine, installing, installed, failed. Whichever it is, it is the same
// place, and clicking it is what opens the detail.

/** Rough finished size, so the download isn't a surprise. */
const APPROX_SIZE = '~250 MB'

function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  const mb = bytes / 1_000_000
  return mb < 1000 ? `${Math.round(mb)} MB` : `${(mb / 1000).toFixed(2)} GB`
}

// ── The progress ring ──────────────────────────────────────────────────
//
// A ring rather than the bar this replaced, because the bar needed a line of
// its own and the chip is one line. It is the same number: a determinate
// fraction, because the package counter makes it determinate, and an
// indeterminate shimmer over a five-minute download says less than a number.

const RING_RADIUS = 6
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ProgressRing({ percent }: { percent: number }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <svg
      className="tex-chip__ring"
      width={15}
      height={15}
      viewBox="0 0 16 16"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle className="tex-chip__ring-track" cx="8" cy="8" r={RING_RADIUS} />
      <circle
        className="tex-chip__ring-fill"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped / 100)}
      />
    </svg>
  )
}

// ── Where the popover goes ─────────────────────────────────────────────

const EDGE = 8
const GAP = 6

/**
 * Place the panel against its anchor, inside the viewport.
 *
 * `fixed`, and measured, for two reasons. The chip lives at the bottom of the
 * window — the build panel is the last thing above the status bar — so a
 * panel that opens downwards opens off the screen, and the first version of
 * this did: you got the first line and a half of it. And the tab row it sits
 * in is inside a pane that clips its overflow, so no amount of `bottom: 100%`
 * would have been enough on its own.
 *
 * Above by preference, below if there is more room there, and never past an
 * edge in either direction.
 */
function useAnchoredPosition(
  open: boolean,
  anchor: React.RefObject<HTMLElement | null>,
  panel: React.RefObject<HTMLElement | null>,
  // Anything that changes the panel's size has to re-run the measurement.
  ...deps: unknown[]
): React.CSSProperties {
  // Hidden until measured: one frame of a panel in the wrong place reads as a
  // flicker, and there is no way to know the size without laying it out.
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })

  const place = useCallback((): void => {
    const a = anchor.current?.getBoundingClientRect()
    const p = panel.current?.getBoundingClientRect()
    if (!a || !p) return

    const roomAbove = a.top - GAP - EDGE
    const roomBelow = window.innerHeight - a.bottom - GAP - EDGE
    const above = roomAbove >= p.height || roomAbove >= roomBelow

    const top = above
      ? Math.max(EDGE, a.top - GAP - p.height)
      : Math.min(a.bottom + GAP, window.innerHeight - p.height - EDGE)

    // Right-aligned to the chip, which is itself right-aligned in its row —
    // then clamped, so a narrow window slides it left rather than off.
    const left = Math.max(EDGE, Math.min(a.right - p.width, window.innerWidth - p.width - EDGE))

    setStyle({
      top: Math.max(EDGE, top),
      left,
      maxHeight: window.innerHeight - 2 * EDGE,
      visibility: 'visible'
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, panel])

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' })
      return undefined
    }
    place()
    window.addEventListener('resize', place)
    // Capture: the panes this sits inside scroll, and the chip moves with them.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place, ...deps])

  return style
}

// ── What the chip says ─────────────────────────────────────────────────

export type ChipState = 'missing' | 'installing' | 'ready' | 'failed'

export function chipState(
  installed: boolean,
  installing: boolean,
  progress: TexInstallProgress
): ChipState {
  if (installing) return 'installing'
  if (installed) return 'ready'
  return progress.phase === 'failed' ? 'failed' : 'missing'
}

/**
 * The app's TeX installation, in one line of the build panel's tab row.
 *
 * Four states, one place. The chip is quiet when there is nothing to do and
 * loud when there is: "No LaTeX" is a call to action and is styled like one,
 * because a build that cannot run is the most important thing in the panel.
 */
export function TexInstallChip(): React.JSX.Element | null {
  const loaded = useTexStore((s) => s.loaded)
  const installed = useTexStore((s) => s.installed)
  const installing = useTexStore((s) => s.installing)
  const progress = useTexStore((s) => s.progress)
  const version = useTexStore((s) => s.version)
  const sizeBytes = useTexStore((s) => s.sizeBytes)
  const directory = useTexStore((s) => s.directory)
  const systemTexAvailable = useTexStore((s) => s.systemTexAvailable)
  const install = useTexStore((s) => s.install)
  const cancel = useTexStore((s) => s.cancel)
  const remove = useTexStore((s) => s.remove)
  const reveal = useTexStore((s) => s.reveal)

  const [open, setOpen] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const state = chipState(installed, installing, progress)
  const position = useAnchoredPosition(open, buttonRef, panelRef, state, confirmingRemove)

  const close = useCallback((): void => {
    setOpen(false)
    setConfirmingRemove(false)
  }, [])

  // Any click elsewhere puts it away, and Escape does too — it is a popover
  // over a panel people are reading, not a mode to get stuck in.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      if (panelRef.current?.contains(event.target as Node)) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  if (!loaded) return null

  // Nothing to offer when a TeX the user installed themselves is already
  // working and ours isn't in the way.
  if (state === 'missing' && systemTexAvailable) return null

  const size = formatSize(sizeBytes)
  // Adding one package to a working tree and downloading the whole
  // distribution are the same phase machinery and very different waits.
  const busyLabel = installed ? 'Adding packages' : 'Installing TeX Live'

  return (
    <div className={`tex-chip tex-chip--${state}`} ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={'tex-chip__button' + (open ? ' tex-chip__button--open' : '')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          state === 'ready'
            ? 'The LaTeX installation this app manages'
            : state === 'installing'
              ? `${busyLabel} — ${progress.percent}%`
              : 'No LaTeX engine — click to install one'
        }
        onClick={() => (open ? close() : setOpen(true))}
      >
        {state === 'ready' && (
          <>
            <CheckCircle2 size={12} strokeWidth={2.5} className="tex-chip__ok" />
            <span className="tex-chip__name">{version ?? 'TeX Live'}</span>
            {size && <span className="tex-chip__meta">{size}</span>}
          </>
        )}
        {state === 'installing' && (
          <>
            <ProgressRing percent={progress.percent} />
            <span className="tex-chip__name">{busyLabel}</span>
            {/* The step it is on. A five-minute job with a number and no
                subject looks stuck; "amsfonts (41 of 134)" does not. */}
            <span className="tex-chip__step">{progress.message}</span>
            <span className="tex-chip__meta">{progress.percent}%</span>
          </>
        )}
        {state === 'missing' && (
          <>
            <Download size={12} strokeWidth={2.5} />
            <span className="tex-chip__name">No LaTeX</span>
          </>
        )}
        {state === 'failed' && (
          <>
            <AlertTriangle size={12} strokeWidth={2.5} />
            <span className="tex-chip__name">Install failed</span>
          </>
        )}
      </button>

      {open && (
        <div
          className="tex-chip__panel"
          ref={panelRef}
          style={position}
          role="dialog"
          aria-label="Managed TeX installation"
        >
          {state === 'ready' ? (
            <>
              <p className="tex-chip__detail">
                Managed by this app, in its own folder. Removing it deletes that folder and nothing
                else.
              </p>
              {/* `<bdi>`, so the path keeps its own left-to-right order inside
                  a box laid out right-to-left to put the ellipsis at the front. */}
              <p className="tex-chip__path" title={directory}>
                <bdi>{directory}</bdi>
              </p>
              <div className="tex-chip__actions">
                <button className="tex-install__ghost" onClick={() => void reveal()}>
                  <FolderOpen size={13} strokeWidth={2.25} />
                  Show folder
                </button>
                <span className="tex-install__spacer" />
                {confirmingRemove ? (
                  <>
                    <button
                      className="tex-install__ghost"
                      onClick={() => setConfirmingRemove(false)}
                    >
                      Keep
                    </button>
                    <button
                      className="tex-install__danger"
                      onClick={() => {
                        close()
                        void remove()
                      }}
                    >
                      Delete it
                    </button>
                  </>
                ) : (
                  <button className="tex-install__ghost" onClick={() => setConfirmingRemove(true)}>
                    <Trash2 size={13} strokeWidth={2.25} />
                    Remove
                  </button>
                )}
              </div>
            </>
          ) : state === 'installing' ? (
            <>
              <p className="tex-chip__detail">
                {busyLabel}. This runs in the background — you can carry on writing, and the paper
                will build as soon as it finishes.
              </p>
              <p className="tex-chip__step-full">{progress.message}</p>
              <div className="tex-chip__actions">
                <span className="tex-install__spacer" />
                <button className="tex-install__ghost" onClick={() => void cancel()}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="tex-chip__detail">
                {state === 'failed'
                  ? (progress.error ?? 'The install did not finish.')
                  : 'Installs into a folder this app owns — no administrator rights, nothing added to your PATH, and removable in one click.'}
              </p>
              <div className="tex-chip__actions">
                <span className="tex-install__spacer" />
                <button
                  className="tex-install__action"
                  onClick={() => {
                    close()
                    void install()
                  }}
                >
                  {state === 'failed' ? 'Try again' : `Install TeX Live  (${APPROX_SIZE})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The build stopped for a package we can go and get.
 *
 * The install manifest is a fixed guess about what papers load, so a document
 * that reaches past it hits `File 'mathtools.sty' not found` and a fatal
 * error — an answer that is both correct and useless, since the fix is one
 * `tlmgr install` the app is perfectly able to run itself. This makes the
 * missing package a button, and rebuilds afterwards so the click finishes the
 * job rather than handing back a stale failure.
 *
 * Still a card rather than a chip, unlike everything above: this is about
 * *this build*, it appears in answer to the errors below it, and it goes away
 * again once they are fixed. It belongs with the problems.
 *
 * Only shown for the managed installation. On a TeX the user installed
 * themselves, adding packages to their tree is not ours to do.
 */
export function MissingPackagesCard(): React.JSX.Element | null {
  const missing = usePaperStore((s) => s.build.missingPackages)
  const paperId = usePaperStore((s) => s.paperId)
  const setBuildState = usePaperStore((s) => s.setBuildState)
  const installed = useTexStore((s) => s.installed)
  const installing = useTexStore((s) => s.installing)
  const installPackages = useTexStore((s) => s.installPackages)

  // While the chip is showing a progress ring, a card saying the same thing
  // is noise.
  if (installing || !installed || missing.length === 0) return null

  const names = missing.map((m) => m.name)

  const go = async (): Promise<void> => {
    await installPackages(names)
    if (!paperId) return
    // TeX stops at the first missing file, so this may surface the next one —
    // which is the point: each round is one click and it converges.
    setBuildState({ state: 'running', errors: [], missingPackages: [], log: '' })
    await window.latexAPI.build(paperId).catch((err: Error) => {
      setBuildState({ state: 'error', errors: [{ message: err.message, severity: 'error' }] })
    })
  }

  return (
    <div className="tex-install tex-install--missing">
      <div className="tex-install__row">
        <Package size={14} strokeWidth={2.5} />
        <span className="tex-install__title">
          {names.length === 1 ? `Missing package: ${names[0]}` : `${names.length} missing packages`}
        </span>
        <span className="tex-install__spacer" />
        <button className="tex-install__action" onClick={() => void go()}>
          {names.length === 1 ? 'Install it' : 'Install them'}
        </button>
      </div>
      <p className="tex-install__detail">
        This paper loads {missing.map((m) => m.file).join(', ')}, which the app&apos;s TeX
        installation doesn&apos;t have. Installing {names.join(', ')} takes a few seconds and the
        paper is rebuilt afterwards.
      </p>
    </div>
  )
}

/**
 * Keep the store fresh while a paper is open.
 *
 * A build that fails for want of an engine is the moment this matters most,
 * so the state is re-read when one lands rather than only at startup.
 */
export function useTexState(): void {
  const refresh = useTexStore((s) => s.refresh)
  const buildState = usePaperStore((s) => s.build.state)

  useEffect(() => {
    void refresh()
  }, [refresh, buildState])
}
