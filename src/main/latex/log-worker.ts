import { parentPort } from 'worker_threads'
import { parseLatexLog } from './log-parser'
import { missingPackagesFromLog } from './tex-packages'

// The log-reading half of a build, off the main thread.
//
// `parseLatexLog` and `missingPackagesFromLog` each walk every line of the
// `.log` file with a handful of regexes. On a short paper that is nothing. On
// a real one it is a few megabytes of TeX's very chatty output, and both of
// them run at the moment the build finishes — which is the moment the
// renderer is asking for the new PDF bytes and repainting the preview. The
// main process is single-threaded, so for as long as that walk is running
// every IPC reply the window is waiting on is queued behind it, and the whole
// app stops answering.
//
// It is one message in, one message out; the worker holds no state. See
// `log-analysis.ts` for the pool, the fallback, and why there is one.

export interface LogAnalysisRequest {
  id: number
  log: string
  /** Only asked for on a failed build — see the compiler. */
  wantMissing: boolean
}

parentPort?.on('message', (request: LogAnalysisRequest) => {
  const { id, log, wantMissing } = request
  try {
    parentPort?.postMessage({
      id,
      errors: parseLatexLog(log),
      missingPackages: wantMissing ? missingPackagesFromLog(log) : []
    })
  } catch (err) {
    parentPort?.postMessage({ id, error: (err as Error).message })
  }
})
