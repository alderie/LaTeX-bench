import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import type { TexInstallProgress, TexInstallState } from '@shared/types'
import { chipState, TexInstallChip } from '@renderer/components/TexInstallCard'
import { useTexStore } from '@renderer/stores/texStore'

// One chip, four states.
//
// This used to be two surfaces: a chip in the tab row once TeX was installed,
// and — for every other state — a card above the problem list with a title, a
// paragraph and a button, permanently taking two lines off the one panel in
// the app whose job is to show you what went wrong. Now "no engine",
// "installing", "installed" and "failed" are the same line in the same place,
// and clicking it is what opens the detail.

const IDLE: TexInstallProgress = { phase: 'idle', percent: 0, message: '' }

function setState(patch: Partial<TexInstallState> & { loaded?: boolean }): void {
  useTexStore.setState({
    loaded: true,
    installed: false,
    installing: false,
    directory: '/tmp/tex',
    binDir: null,
    version: null,
    sizeBytes: 0,
    progress: IDLE,
    systemTexAvailable: false,
    ...patch
  })
}

beforeEach(() => {
  // Every action on the chip goes through the preload bridge; the component
  // only ever reads the store, so a stub is enough to click things.
  vi.stubGlobal('texAPI', {
    getState: vi.fn(),
    install: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
    installPackages: vi.fn(),
    reveal: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('which state the chip is in', () => {
  it('is installing whenever an install is running, installed or not', () => {
    // Adding one package to a working tree and downloading the whole
    // distribution are the same phase machinery — both are "busy".
    expect(chipState(false, true, IDLE)).toBe('installing')
    expect(chipState(true, true, IDLE)).toBe('installing')
  })

  it('is ready when there is an installation and nothing running', () => {
    expect(chipState(true, false, IDLE)).toBe('ready')
  })

  it('is failed only when the last attempt failed', () => {
    expect(chipState(false, false, { ...IDLE, phase: 'failed', error: 'no' })).toBe('failed')
    expect(chipState(false, false, IDLE)).toBe('missing')
  })
})

describe('the chip', () => {
  it('says nothing until the first state has landed', () => {
    setState({ loaded: false })
    const { container } = render(<TexInstallChip />)
    expect(container.innerHTML).toBe('')
  })

  it('offers nothing when the author already has their own TeX', () => {
    setState({ systemTexAvailable: true })
    const { container } = render(<TexInstallChip />)
    expect(container.innerHTML).toBe('')
  })

  it('still offers to install when a previous attempt failed, system TeX or not', () => {
    setState({ systemTexAvailable: true, progress: { ...IDLE, phase: 'failed', error: 'nope' } })
    render(<TexInstallChip />)
    expect(screen.getByText('Install failed')).toBeTruthy()
  })

  it('names the version and the size once installed', () => {
    setState({ installed: true, version: 'TeX Live 2026', sizeBytes: 294_000_000 })
    render(<TexInstallChip />)
    expect(screen.getByText('TeX Live 2026')).toBeTruthy()
    expect(screen.getByText('294 MB')).toBeTruthy()
  })

  it('is where you go to install one when there is none', () => {
    // The whole point of folding the card in: the chip is the place, whatever
    // state it is in.
    setState({})
    render(<TexInstallChip />)
    fireEvent.click(screen.getByRole('button', { name: /No LaTeX/ }))
    fireEvent.click(screen.getByText(/Install TeX Live/))
    expect(window.texAPI.install).toHaveBeenCalled()
  })

  it('offers to try again after a failure, and says why it failed', () => {
    setState({
      progress: { phase: 'failed', percent: 40, message: '', error: 'mirror unreachable' }
    })
    render(<TexInstallChip />)
    fireEvent.click(screen.getByRole('button', { name: /Install failed/ }))
    expect(screen.getByText('mirror unreachable')).toBeTruthy()
    fireEvent.click(screen.getByText('Try again'))
    expect(window.texAPI.install).toHaveBeenCalled()
  })
})

describe('while it is installing', () => {
  const BUSY: TexInstallProgress = {
    phase: 'packages',
    percent: 42,
    message: 'amsfonts (56 of 134)'
  }

  it('shows a ring wound to the percentage', () => {
    setState({ installing: true, progress: BUSY })
    const { container } = render(<TexInstallChip />)
    const ring = container.querySelector('[role="progressbar"]')!
    expect(ring.getAttribute('aria-valuenow')).toBe('42')

    // The gap left in the ring is the part still to do.
    const fill = container.querySelector('.tex-chip__ring-fill')!
    const circumference = Number(fill.getAttribute('stroke-dasharray'))
    const offset = Number(fill.getAttribute('stroke-dashoffset'))
    expect(offset / circumference).toBeCloseTo(0.58, 2)
  })

  it('names the step it is on', () => {
    // A five-minute job with a number and no subject looks stuck.
    setState({ installing: true, progress: BUSY })
    render(<TexInstallChip />)
    expect(screen.getByText('amsfonts (56 of 134)')).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()
  })

  it('says which of the two waits this is', () => {
    setState({ installing: true, installed: true, progress: BUSY })
    render(<TexInstallChip />)
    expect(screen.getByText('Adding packages')).toBeTruthy()
  })

  it('can be called off', () => {
    setState({ installing: true, progress: BUSY })
    render(<TexInstallChip />)
    fireEvent.click(screen.getByRole('button', { name: /Installing TeX Live/ }))
    fireEvent.click(screen.getByText('Cancel'))
    expect(window.texAPI.cancel).toHaveBeenCalled()
  })

  it('never winds the ring past its ends', () => {
    for (const [percent, fraction] of [
      [-10, 1],
      [0, 1],
      [150, 0]
    ] as const) {
      cleanup()
      setState({ installing: true, progress: { ...BUSY, percent } })
      const { container } = render(<TexInstallChip />)
      const fill = container.querySelector('.tex-chip__ring-fill')!
      const circumference = Number(fill.getAttribute('stroke-dasharray'))
      expect(Number(fill.getAttribute('stroke-dashoffset')) / circumference).toBeCloseTo(
        fraction,
        5
      )
    }
  })
})

describe('removing it', () => {
  beforeEach(() => {
    setState({ installed: true, version: 'TeX Live 2026', sizeBytes: 294_000_000 })
    render(<TexInstallChip />)
    fireEvent.click(screen.getByRole('button', { name: /TeX Live 2026/ }))
  })

  it('asks first, because it deletes a quarter of a gigabyte', async () => {
    fireEvent.click(screen.getByText('Remove'))
    expect(window.texAPI.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Delete it'))
    expect(window.texAPI.remove).toHaveBeenCalled()
    // The store writes the new state when the removal resolves, which is
    // after this test's last assertion — let it land inside the test rather
    // than warning about an update outside `act`.
    await act(async () => undefined)
  })

  it('takes no for an answer', () => {
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(screen.getByText('Keep'))
    expect(screen.getByText('Remove')).toBeTruthy()
    expect(window.texAPI.remove).not.toHaveBeenCalled()
  })

  it('shows the folder it would delete', () => {
    expect(screen.getByText('/tmp/tex')).toBeTruthy()
  })
})

describe('the popover', () => {
  it('closes on Escape', () => {
    setState({ installed: true, version: 'TeX Live 2026' })
    render(<TexInstallChip />)
    const button = screen.getByRole('button', { name: /TeX Live 2026/ })
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on a click outside it', () => {
    setState({ installed: true, version: 'TeX Live 2026' })
    render(<TexInstallChip />)
    fireEvent.click(screen.getByRole('button', { name: /TeX Live 2026/ }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays open while it is being used', () => {
    setState({ installed: true, version: 'TeX Live 2026' })
    render(<TexInstallChip />)
    fireEvent.click(screen.getByRole('button', { name: /TeX Live 2026/ }))
    fireEvent.mouseDown(screen.getByText('Remove'))
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})
