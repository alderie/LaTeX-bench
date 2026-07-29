import { describe, it, expect, afterAll } from 'vitest'
import { analyseLog, stopLogAnalysis } from '../src/main/latex/log-analysis'
import { parseLatexLog } from '../src/main/latex/log-parser'
import { missingPackagesFromLog } from '../src/main/latex/tex-packages'

// Reading a compile log, off the thread that answers the window.
//
// Both walks — the error parse and the missing-package scan — used to run in
// the main process at the moment a build finished, which is the moment the
// renderer is asking for the new PDF bytes. On a few megabytes of TeX output
// that is a visible stall in an app the author is still typing into.
//
// The contract these tests hold it to is the one that matters: *whatever*
// happens to the worker, the answer comes back, and it is the same answer.
// The fallback is not a nicety here — under a test runner there is no bundled
// worker file to find, so every case below is taking it.

const ERROR_LOG = [
  'This is pdfTeX, Version 3.141592653',
  './main.tex:42: Undefined control sequence.',
  'l.42 \\badmacro',
  "LaTeX Warning: Citation `smith2020' undefined on page 1.",
  '! Emergency stop.'
].join('\n')

const MISSING_LOG = "! LaTeX Error: File `mathtools.sty' not found."

/** A log big enough to cross the threshold that hands work to the worker. */
function big(seed: string): string {
  const filler = 'Overfull \\hbox (3.0pt too wide) in paragraph at lines 1--2\n'.repeat(2000)
  return `${seed}\n${filler}`
}

afterAll(() => {
  stopLogAnalysis()
})

describe('analyseLog', () => {
  it('finds the errors a small log holds', async () => {
    const { errors } = await analyseLog(ERROR_LOG, false)
    expect(errors.some((e) => e.message.includes('Undefined control sequence'))).toBe(true)
    expect(errors.some((e) => e.severity === 'warning')).toBe(true)
  })

  it('gives the same answer as parsing it directly', async () => {
    // The whole point of moving the walk is that it is the same walk.
    const { errors } = await analyseLog(ERROR_LOG, false)
    expect(errors).toEqual(parseLatexLog(ERROR_LOG))
  })

  it('gives the same answer on a log large enough to be handed off', async () => {
    const log = big(ERROR_LOG)
    const { errors } = await analyseLog(log, false)
    expect(errors).toEqual(parseLatexLog(log))
  })

  it('names the missing package when asked', async () => {
    const { missingPackages } = await analyseLog(MISSING_LOG, true)
    expect(missingPackages.map((p) => p.name)).toContain('mathtools')
  })

  it('does not go looking for missing packages when it was not asked', async () => {
    // A successful build can still mention a file it didn't find on a first
    // pass and then resolved, so the scan is only worth running on a failure.
    expect(missingPackagesFromLog(MISSING_LOG).length).toBeGreaterThan(0)
    const { missingPackages } = await analyseLog(MISSING_LOG, false)
    expect(missingPackages).toEqual([])
  })

  it('still answers when the log is large and the package scan is on', async () => {
    const log = big(MISSING_LOG)
    const { errors, missingPackages } = await analyseLog(log, true)
    expect(errors).toEqual(parseLatexLog(log))
    expect(missingPackages).toEqual(missingPackagesFromLog(log))
  })

  it('answers on an empty log without inventing anything', async () => {
    expect(await analyseLog('', true)).toEqual({ errors: [], missingPackages: [] })
  })

  it('can be shut down and used again', async () => {
    // Quitting calls this, and a stray build finishing afterwards must not
    // hang on a thread that is gone.
    stopLogAnalysis()
    const { errors } = await analyseLog(big(ERROR_LOG), false)
    expect(errors.length).toBeGreaterThan(0)
  })
})
