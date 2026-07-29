import { Worker } from 'worker_threads'
import { existsSync } from 'fs'
import { join } from 'path'
import type { BuildError, MissingPackage } from '../../shared/types'
import { parseLatexLog } from './log-parser'
import { missingPackagesFromLog } from './tex-packages'

// One long-lived worker that reads compile logs, and an honest fallback.
//
// Long-lived because a build can finish every couple of seconds while the
// author types, and spawning a thread per build would cost more than the
// parse it is avoiding. Idle it holds a few hundred kilobytes and no CPU.
//
// The fallback matters as much as the worker. Whether a bundler emitted
// `log-worker.js` next to the main bundle is a build-time property this
// module cannot check at compile time, and a missing worker file must not
// mean builds stop reporting their errors. So every path here ends in an
// answer: if the thread can't start, dies, or doesn't reply in time, the work
// is done in-process — slower, and correct.

export interface LogAnalysis {
  errors: BuildError[]
  missingPackages: MissingPackage[]
}

/** Beyond this the walk is worth a thread; under it, the hand-off costs more. */
const WORKER_THRESHOLD_BYTES = 64 * 1024

/**
 * How long to wait before giving up on the thread and parsing here.
 *
 * Not a correctness guard — it is what keeps a wedged worker from turning
 * into a build that never reports anything at all.
 */
const WORKER_TIMEOUT_MS = 10_000

interface Pending {
  resolve: (value: LogAnalysis) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let unavailable = false
let nextId = 1
const pending = new Map<number, Pending>()

function workerPath(): string | null {
  // Emitted beside the main bundle by the extra rollup input in
  // electron.vite.config.ts. In dev and in production it is the same layout.
  //
  // `__dirname` is checked rather than used: the main process is bundled to
  // CommonJS and has it, but this module is also reachable from the test
  // runner, which is ESM and does not — and a ReferenceError here would turn
  // "the worker isn't available" into "builds throw".
  if (typeof __dirname !== 'string') return null
  // The parent as well as the directory itself: whether this module ends up
  // inlined into the main bundle or split into `chunks/` is a decision rollup
  // makes about module sharing, and the worker is emitted beside the bundle
  // either way.
  for (const dir of [__dirname, join(__dirname, '..')]) {
    for (const name of ['log-worker.js', 'log-worker.mjs', 'log-worker.cjs']) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (unavailable) return null
  const path = workerPath()
  if (!path) {
    unavailable = true
    return null
  }
  try {
    const created = new Worker(path)
    created.on('message', (message: { id: number; error?: string } & Partial<LogAnalysis>) => {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      clearTimeout(waiting.timer)
      if (message.error) waiting.reject(new Error(message.error))
      else
        waiting.resolve({
          errors: message.errors ?? [],
          missingPackages: message.missingPackages ?? []
        })
    })
    // A thread that died takes every request in flight with it. Fail them
    // explicitly so each one falls back rather than hanging until its timer.
    const collapse = (err: Error): void => {
      worker = null
      for (const [, waiting] of pending) {
        clearTimeout(waiting.timer)
        waiting.reject(err)
      }
      pending.clear()
    }
    created.on('error', (err) => collapse(err))
    created.on('exit', (code) => {
      if (code !== 0) collapse(new Error(`log worker exited with code ${code}`))
      else worker = null
    })
    // Don't hold the process open for the sake of an idle parser.
    created.unref()
    worker = created
    return worker
  } catch {
    unavailable = true
    return null
  }
}

/** Parse here and now. The answer the worker would have given. */
function inProcess(log: string, wantMissing: boolean): LogAnalysis {
  return {
    errors: parseLatexLog(log),
    missingPackages: wantMissing ? missingPackagesFromLog(log) : []
  }
}

/**
 * Read a compile log: its errors, and the packages it says are missing.
 *
 * Always resolves. A small log is parsed here — the thread hand-off is a
 * structured clone of the whole string, which for a few kilobytes costs more
 * than the parse. A large one goes to the worker, and comes back here if
 * anything at all goes wrong with that.
 */
export async function analyseLog(log: string, wantMissing: boolean): Promise<LogAnalysis> {
  if (log.length < WORKER_THRESHOLD_BYTES) return inProcess(log, wantMissing)

  const thread = ensureWorker()
  if (!thread) return inProcess(log, wantMissing)

  const id = nextId++
  try {
    return await new Promise<LogAnalysis>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('log worker timed out'))
      }, WORKER_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      thread.postMessage({ id, log, wantMissing })
    })
  } catch {
    return inProcess(log, wantMissing)
  }
}

/** Shut the thread down — called when the app is quitting. */
export function stopLogAnalysis(): void {
  const thread = worker
  worker = null
  for (const [, waiting] of pending) clearTimeout(waiting.timer)
  pending.clear()
  void thread?.terminate()
}
