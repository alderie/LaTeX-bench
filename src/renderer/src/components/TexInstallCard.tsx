import * as React from 'react'
import { useEffect, useState } from 'react'
import { CheckCircle2, Download, FolderOpen, Loader2, Trash2, X } from 'lucide-react'
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
  const version = useTexStore((s) => s.version)
  const sizeBytes = useTexStore((s) => s.sizeBytes)
  const directory = useTexStore((s) => s.directory)
  const systemTexAvailable = useTexStore((s) => s.systemTexAvailable)
  const install = useTexStore((s) => s.install)
  const cancel = useTexStore((s) => s.cancel)
  const remove = useTexStore((s) => s.remove)
  const reveal = useTexStore((s) => s.reveal)

  const [confirmingRemove, setConfirmingRemove] = useState(false)

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
          <span className="tex-install__title">Installing TeX Live</span>
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

  if (installed) {
    return (
      <div className="tex-install tex-install--ready">
        <div className="tex-install__row">
          <CheckCircle2 size={14} strokeWidth={2.5} className="tex-install__ok" />
          <span className="tex-install__title">{version ?? 'TeX Live'} installed</span>
          <span className="tex-install__meta">{formatSize(sizeBytes)}</span>
          <span className="tex-install__spacer" />
          <button
            className="tex-install__ghost"
            onClick={() => void reveal()}
            title={directory}
            aria-label="Show the folder"
          >
            <FolderOpen size={13} strokeWidth={2.25} />
          </button>
          {confirmingRemove ? (
            <>
              <button
                className="tex-install__danger"
                onClick={() => {
                  setConfirmingRemove(false)
                  void remove()
                }}
              >
                Delete it
              </button>
              <button className="tex-install__ghost" onClick={() => setConfirmingRemove(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              className="tex-install__ghost"
              onClick={() => setConfirmingRemove(true)}
              title="Remove the managed installation"
              aria-label="Remove TeX Live"
            >
              <Trash2 size={13} strokeWidth={2.25} />
            </button>
          )}
        </div>
        <p className="tex-install__detail">
          Managed by this app, in its own folder. Removing it deletes that folder and nothing else.
        </p>
      </div>
    )
  }

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
