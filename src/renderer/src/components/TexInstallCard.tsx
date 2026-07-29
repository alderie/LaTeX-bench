import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, FolderOpen, Loader2, Package, Trash2, X } from 'lucide-react'
import { useTexStore } from '../stores/texStore'
import { usePaperStore } from '../stores/paperStore'

// Getting LaTeX, without going and getting LaTeX.
//
// The build panel can now tell you that no engine was found. That is only
// half an answer: the other half used to be "go and install a four-gigabyte
// distribution, then come back". This is the other half.
//
// What it installs goes in one directory the app owns — nothing in
// /usr/local, nothing on your PATH, no administrator prompt — which is what
// makes the Remove button honest. It is the same directory the papers are
// in, so "get rid of this app and everything it downloaded" stays a matter
// of deleting one folder.

/** Rough finished size, so the download isn't a surprise. */
const APPROX_SIZE = '~250 MB'

function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  const mb = bytes / 1_000_000
  return mb < 1000 ? `${Math.round(mb)} MB` : `${(mb / 1000).toFixed(2)} GB`
}

export function TexInstallCard(): React.JSX.Element | null {
  const loaded = useTexStore((s) => s.loaded)
  const installed = useTexStore((s) => s.installed)
  const installing = useTexStore((s) => s.installing)
  const progress = useTexStore((s) => s.progress)
  const systemTexAvailable = useTexStore((s) => s.systemTexAvailable)
  const install = useTexStore((s) => s.install)
  const cancel = useTexStore((s) => s.cancel)

  if (!loaded) return null

  // Nothing to offer when a TeX the user installed themselves is already
  // working and ours isn't in the way.
  if (!installed && !installing && systemTexAvailable && progress.phase !== 'failed') {
    return null
  }

  if (installing) {
    return (
      <div className="tex-install tex-install--busy">
        <div className="tex-install__row">
          <Loader2 size={14} strokeWidth={2.5} className="tex-install__spin" />
          {/* Adding one package to a working tree and downloading the whole
              distribution are the same phase machinery and very different
              waits — say which one this is. */}
          <span className="tex-install__title">
            {installed ? 'Adding packages' : 'Installing TeX Live'}
          </span>
          <span className="tex-install__percent">{progress.percent}%</span>
          <button className="tex-install__ghost" onClick={() => void cancel()} title="Cancel">
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
        <div
          className="tex-install__bar"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="tex-install__bar-fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="tex-install__detail">{progress.message}</p>
      </div>
    )
  }

  // A working installation is not a problem, and the Problems tab is where
  // this used to spend two lines saying so. It is a status, so it is a chip —
  // see `TexInstallChip`, which sits in the panel's tab row.
  if (installed) return null

  return (
    <div className="tex-install">
      <div className="tex-install__row">
        <Download size={14} strokeWidth={2.5} />
        <span className="tex-install__title">
          {progress.phase === 'failed' ? 'Installation failed' : 'No LaTeX engine found'}
        </span>
        <span className="tex-install__spacer" />
        <button className="tex-install__action" onClick={() => void install()}>
          {progress.phase === 'failed' ? 'Try again' : `Install TeX Live  (${APPROX_SIZE})`}
        </button>
      </div>
      <p className="tex-install__detail">
        {progress.error ??
          'Installs into a folder this app owns — no administrator rights, nothing added to your PATH, and removable in one click.'}
      </p>
    </div>
  )
}

/**
 * The managed installation, in one line of the tab row.
 *
 * What this replaced was a card above the problem list: a title, a size, two
 * icon buttons and a sentence of explanation, permanently occupying two lines
 * of the one panel in the app whose whole job is to show you what went wrong.
 * It earned that space exactly once — the first time you read it. After that
 * it is a fact that does not change, and a fact that does not change belongs
 * in a chip.
 *
 * The sentence and the two buttons are still here; they are behind the chip,
 * which is where something you need twice a year should be. Removing is still
 * two clicks, because it deletes a quarter of a gigabyte.
 */
export function TexInstallChip(): React.JSX.Element | null {
  const loaded = useTexStore((s) => s.loaded)
  const installed = useTexStore((s) => s.installed)
  const installing = useTexStore((s) => s.installing)
  const version = useTexStore((s) => s.version)
  const sizeBytes = useTexStore((s) => s.sizeBytes)
  const directory = useTexStore((s) => s.directory)
  const remove = useTexStore((s) => s.remove)
  const reveal = useTexStore((s) => s.reveal)

  const [open, setOpen] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Any click elsewhere puts it away, and Escape does too — it is a popover
  // over a panel people are reading, not a mode to get stuck in.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setConfirmingRemove(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      setConfirmingRemove(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // While a package install is running the shared card below is showing a
  // progress bar, and a chip claiming everything is fine alongside it is a
  // contradiction.
  if (!loaded || !installed || installing) return null

  const size = formatSize(sizeBytes)

  return (
    <div className="tex-chip" ref={rootRef}>
      <button
        type="button"
        className={'tex-chip__button' + (open ? ' tex-chip__button--open' : '')}
        aria-expanded={open}
        title="The LaTeX installation this app manages"
        onClick={() => {
          setOpen((was) => !was)
          setConfirmingRemove(false)
        }}
      >
        <CheckCircle2 size={12} strokeWidth={2.5} className="tex-chip__ok" />
        <span className="tex-chip__name">{version ?? 'TeX Live'}</span>
        {size && <span className="tex-chip__meta">{size}</span>}
      </button>

      {open && (
        <div className="tex-chip__panel" role="dialog" aria-label="Managed TeX installation">
          <p className="tex-chip__detail">
            Managed by this app, in its own folder. Removing it deletes that folder and nothing
            else.
          </p>
          {/* `<bdi>`, so the path keeps its own left-to-right order inside a
              box laid out right-to-left to put the ellipsis at the front. */}
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
                <button className="tex-install__ghost" onClick={() => setConfirmingRemove(false)}>
                  Keep
                </button>
                <button
                  className="tex-install__danger"
                  onClick={() => {
                    setConfirmingRemove(false)
                    setOpen(false)
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

  // While the shared install card is showing a progress bar, a second card
  // saying the same thing is noise.
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
