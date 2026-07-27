import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePaperStore } from '@renderer/stores/paperStore'

// Multi-file papers, and the one write that has to land on the right file.

interface FakeDisk {
  [path: string]: string
}

function installPaperAPI(disk: FakeDisk): {
  writes: Array<{ path: string; tex: string }>
} {
  const writes: Array<{ path: string; tex: string }> = []
  const api = {
    readTex: vi.fn(async () => disk['main.tex'] ?? ''),
    writeTex: vi.fn(async (_id: string, tex: string) => {
      disk['main.tex'] = tex
    }),
    readBib: vi.fn(async () => ''),
    writeBib: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({ engine: 'latexmk', mainFile: 'main.tex' })),
    readTexFile: vi.fn(async (_id: string, path: string) => disk[path] ?? ''),
    writeTexFile: vi.fn(async (_id: string, path: string, tex: string) => {
      writes.push({ path, tex })
      disk[path] = tex
    }),
    texFileExists: vi.fn(async (_id: string, path: string) => path in disk),
    listTexFiles: vi.fn(async () => Object.keys(disk))
  }
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.paperAPI = api
  return { writes }
}

const MAIN = `\\documentclass{article}
\\begin{document}
\\input{sections/method}
\\input{sections/results}
\\end{document}
`

describe('the file tree', () => {
  beforeEach(() => {
    usePaperStore.setState({ paperId: null, files: [], activeFile: 'main.tex', tex: '' })
  })

  it('walks \\input from the main file', async () => {
    installPaperAPI({
      'main.tex': MAIN,
      'sections/method.tex': '\\section{Method}',
      'sections/results.tex': '\\section{Results}'
    })
    await usePaperStore.getState().loadPaper('p1')
    expect(usePaperStore.getState().files.map((f) => f.path)).toEqual([
      'main.tex',
      'sections/method.tex',
      'sections/results.tex'
    ])
  })

  it('records nesting depth for an include inside an include', async () => {
    installPaperAPI({
      'main.tex': '\\input{part1}',
      'part1.tex': '\\input{part1a}',
      'part1a.tex': 'Deep prose.'
    })
    await usePaperStore.getState().loadPaper('p1')
    expect(usePaperStore.getState().files.map((f) => f.depth)).toEqual([0, 1, 2])
  })

  it('flags an \\input that names a file which is not there', async () => {
    installPaperAPI({ 'main.tex': '\\input{missing}' })
    await usePaperStore.getState().loadPaper('p1')
    const missing = usePaperStore.getState().files.find((f) => f.path === 'missing.tex')
    expect(missing?.missing).toBe(true)
  })

  it('survives a cycle rather than walking it forever', async () => {
    installPaperAPI({
      'main.tex': '\\input{a}',
      'a.tex': '\\input{b}',
      'b.tex': '\\input{a}'
    })
    await usePaperStore.getState().loadPaper('p1')
    expect(usePaperStore.getState().files.map((f) => f.path)).toEqual([
      'main.tex',
      'a.tex',
      'b.tex'
    ])
  })
})

describe('opening a file', () => {
  beforeEach(() => {
    usePaperStore.setState({ paperId: null, files: [], activeFile: 'main.tex', tex: '' })
  })

  it('swaps the visible document', async () => {
    installPaperAPI({ 'main.tex': MAIN, 'sections/method.tex': '\\section{Method}' })
    await usePaperStore.getState().loadPaper('p1')
    await usePaperStore.getState().openFile('sections/method.tex')
    expect(usePaperStore.getState().activeFile).toBe('sections/method.tex')
    expect(usePaperStore.getState().tex).toBe('\\section{Method}')
  })
})

describe('setTexForFile', () => {
  beforeEach(() => {
    usePaperStore.setState({ paperId: null, files: [], activeFile: 'main.tex', tex: '' })
  })

  it('edits the visible document when the file is the active one', async () => {
    installPaperAPI({ 'main.tex': MAIN, 'sections/method.tex': '\\section{Method}' })
    await usePaperStore.getState().loadPaper('p1')
    usePaperStore.getState().setTexForFile('main.tex', 'changed')
    expect(usePaperStore.getState().tex).toBe('changed')
  })

  it('writes a late save to the file it came from, not the one now open', async () => {
    // The rich editor serializes on a trailing delay and flushes on unmount
    // — and unmounting is what switching files does. Before this, that
    // flush was filed under the *new* active file and overwrote it.
    const { writes } = installPaperAPI({
      'main.tex': MAIN,
      'sections/method.tex': '\\section{Method}',
      'sections/results.tex': '\\section{Results}'
    })
    await usePaperStore.getState().loadPaper('p1')
    await usePaperStore.getState().openFile('sections/method.tex')
    await usePaperStore.getState().openFile('sections/results.tex')

    // The pending serialize of method.tex lands now, one file too late.
    usePaperStore.getState().setTexForFile('sections/method.tex', '\\section{Method, edited}')
    await Promise.resolve()

    expect(writes).toContainEqual({
      path: 'sections/method.tex',
      tex: '\\section{Method, edited}'
    })
    // The document on screen is untouched.
    expect(usePaperStore.getState().activeFile).toBe('sections/results.tex')
    expect(usePaperStore.getState().tex).toBe('\\section{Results}')
  })

  it('does nothing when no paper is open', () => {
    installPaperAPI({})
    usePaperStore.setState({ paperId: null })
    expect(() => usePaperStore.getState().setTexForFile('x.tex', 'y')).not.toThrow()
  })
})
