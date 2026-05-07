import type { BuildError } from '../../shared/types'

// Best-effort LaTeX log parser. Real-world TeX logs are notoriously messy
// (line wrapping, recursive includes, TeX boxing prose into the error
// message). We aim for "good enough to surface in CodeMirror lint" — not
// perfect fidelity. Pattern set is the same one used by chktex / TeXstudio:
//
//   "./main.tex:42: Undefined control sequence."   ← preferred (file:line:)
//   "! Undefined control sequence."                  ← fallback
//   "LaTeX Warning: Citation `foo' undefined ..."

const FILE_LINE_RE = /^([^:\n]+):(\d+):\s*(.+)$/
const BANG_RE = /^!\s*(.+)$/
const WARNING_RE = /^(?:LaTeX|Package [^\s]+)\s+Warning:\s*(.+)$/i

export function parseLatexLog(text: string): BuildError[] {
  const errors: BuildError[] = []
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    const m1 = FILE_LINE_RE.exec(line)
    if (m1) {
      errors.push({
        file: m1[1],
        line: Number(m1[2]),
        message: takeContext(lines, i, m1[3]),
        severity: 'error'
      })
      continue
    }

    const m2 = BANG_RE.exec(line)
    if (m2) {
      errors.push({
        message: takeContext(lines, i, m2[1]),
        severity: 'error'
      })
      continue
    }

    const m3 = WARNING_RE.exec(line)
    if (m3) {
      errors.push({
        message: m3[1],
        severity: 'warning'
      })
    }
  }

  // De-dupe identical messages — pdflatex repeats some warnings.
  const seen = new Set<string>()
  return errors.filter((e) => {
    const key = `${e.severity}|${e.file ?? ''}|${e.line ?? ''}|${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Pull a couple of follow-up lines into the message so the user sees the
// "l.42 \badmacro" continuation, which is where the actual culprit appears.
function takeContext(lines: string[], i: number, head: string): string {
  const tail: string[] = []
  for (let j = 1; j <= 2 && i + j < lines.length; j++) {
    const next = lines[i + j].trim()
    if (!next) break
    if (/^[!l\.]/.test(next)) tail.push(next)
  }
  return tail.length ? `${head} — ${tail.join(' ')}` : head
}
