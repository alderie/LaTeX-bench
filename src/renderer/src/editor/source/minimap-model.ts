// The arithmetic and the tokenizing behind the minimap.
//
// Separated from the canvas so the two things that are easy to get wrong —
// where a line sits when the document is taller than the minimap, and which
// line you just clicked on — are plain functions over numbers rather than
// something you can only check by dragging a scrollbar and squinting.

/** One pixel row per document line, plus a gap. VS Code's default feel. */
export const LINE_HEIGHT = 3
/** Width of one character block. */
export const CHAR_WIDTH = 1
/** Characters past this are off the right edge of any sane minimap width. */
export const MAX_COLUMNS = 220

export interface MinimapLayout {
  /** Height the whole document would occupy, in minimap pixels. */
  contentHeight: number
  /** How far the minimap itself is scrolled, in minimap pixels. */
  offset: number
  /** First document line (1-based) that could be visible in the minimap. */
  firstLine: number
  /** Last document line (1-based) that could be visible in the minimap. */
  lastLine: number
}

export interface ViewportInfo {
  /** Total lines in the document. */
  lines: number
  /** Height of the minimap canvas, in CSS pixels. */
  canvasHeight: number
  /** First document line visible in the editor (1-based). */
  topLine: number
  /** Last document line visible in the editor (1-based). */
  bottomLine: number
  /** Editor scroll progress, 0–1. Out-of-range values are clamped. */
  progress: number
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return value < min ? min : value > max ? max : value
}

/**
 * Where the minimap's own content sits.
 *
 * When the document fits, the minimap is the document and nothing scrolls.
 * When it doesn't, the minimap slides in proportion to the editor's scroll —
 * so the top of the file is showing when you're at the top of the file, and
 * the bottom when you're at the bottom. (The alternative, a fixed
 * scaled-to-fit map, turns a 4,000-line paper into an unreadable grey smear.)
 */
export function computeLayout(info: ViewportInfo): MinimapLayout {
  const contentHeight = Math.max(0, info.lines) * LINE_HEIGHT
  const overflow = Math.max(0, contentHeight - info.canvasHeight)
  const offset = overflow * clamp(info.progress, 0, 1)
  const firstLine = Math.max(1, Math.floor(offset / LINE_HEIGHT) + 1)
  const lastLine = Math.min(info.lines, Math.ceil((offset + info.canvasHeight) / LINE_HEIGHT) + 1)
  return { contentHeight, offset, firstLine, lastLine }
}

export interface SliderRect {
  top: number
  height: number
}

/** The translucent block showing which slice of the file you're looking at. */
export function computeSlider(info: ViewportInfo, layout: MinimapLayout): SliderRect {
  const top = (info.topLine - 1) * LINE_HEIGHT - layout.offset
  const visible = Math.max(1, info.bottomLine - info.topLine + 1)
  return { top, height: visible * LINE_HEIGHT }
}

/** Which document line a y-coordinate inside the canvas points at. */
export function lineAtY(y: number, layout: MinimapLayout, lines: number): number {
  const line = Math.floor((y + layout.offset) / LINE_HEIGHT) + 1
  return clamp(line, 1, Math.max(1, lines))
}

// ── Tokenizing ─────────────────────────────────────────────────────────

/** What a run of characters on a line is, for colouring purposes. */
export type RunKind = 'text' | 'macro' | 'brace' | 'comment' | 'math'

export interface Run {
  /** Column the run starts at, 0-based. */
  from: number
  /** Column the run ends at, exclusive. */
  to: number
  kind: RunKind
}

const MACRO_RE = /\\[a-zA-Z@]+\*?|\\./y

/**
 * Split a line into coloured runs.
 *
 * A deliberately cheap approximation of the real highlighter: the minimap is
 * two pixels tall per line, so the only thing colour can convey at that size
 * is texture — where the macros are, where the comments are, where the maths
 * is. Running the actual Lezer tree over every line in view would cost far
 * more than that texture is worth.
 *
 * Whitespace is skipped rather than emitted, which is what gives the minimap
 * its shape: indentation reads as indentation.
 */
export function tokenizeLine(text: string): Run[] {
  const runs: Run[] = []
  const limit = Math.min(text.length, MAX_COLUMNS)
  let i = 0
  let math = false

  while (i < limit) {
    const ch = text[i]

    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }

    // A comment runs to end of line — unless the `%` is escaped.
    if (ch === '%' && (i === 0 || text[i - 1] !== '\\')) {
      push(runs, i, limit, 'comment')
      break
    }

    if (ch === '$') {
      math = !math
      push(runs, i, i + 1, 'math')
      i++
      continue
    }

    if (ch === '\\') {
      MACRO_RE.lastIndex = i
      const match = MACRO_RE.exec(text)
      const end = match ? Math.min(i + match[0].length, limit) : i + 1
      push(runs, i, end, 'macro')
      i = end
      continue
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
      push(runs, i, i + 1, 'brace')
      i++
      continue
    }

    // A word: everything up to the next character that starts a run of its
    // own, so ordinary prose is one rect rather than one per letter.
    let end = i
    while (end < limit && !'\\{}[]$% \t'.includes(text[end])) end++
    if (end === i) end = i + 1
    push(runs, i, end, math ? 'math' : 'text')
    i = end
  }

  return runs
}

function push(runs: Run[], from: number, to: number, kind: RunKind): void {
  if (to <= from) return
  const last = runs[runs.length - 1]
  // Merge with the previous run when they touch and agree — fewer rects to
  // paint, and at one pixel per column the seam is invisible anyway.
  if (last && last.kind === kind && last.to === from) {
    last.to = to
    return
  }
  runs.push({ from, to, kind })
}
