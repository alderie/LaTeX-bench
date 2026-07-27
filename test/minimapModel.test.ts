import { describe, it, expect } from 'vitest'
import {
  LINE_HEIGHT,
  MAX_COLUMNS,
  computeLayout,
  computeSlider,
  lineAtY,
  tokenizeLine,
  type ViewportInfo
} from '@renderer/editor/source/minimap-model'

// The minimap is a canvas, so nothing about it is visible to a DOM
// assertion. What can be checked is the part that decides *what* gets
// painted where — and getting that wrong is what makes a minimap that
// scrolls the wrong way or jumps you to the wrong line.

function viewport(patch: Partial<ViewportInfo> = {}): ViewportInfo {
  return {
    lines: 100,
    canvasHeight: 300,
    topLine: 1,
    bottomLine: 40,
    progress: 0,
    ...patch
  }
}

describe('computeLayout', () => {
  it('does not scroll a document that fits', () => {
    // 100 lines at 3px is 300px, exactly the canvas.
    const layout = computeLayout(viewport({ progress: 1 }))
    expect(layout.contentHeight).toBe(100 * LINE_HEIGHT)
    expect(layout.offset).toBe(0)
    expect(layout.firstLine).toBe(1)
  })

  it('slides in proportion to the editor once the document overflows', () => {
    const info = viewport({ lines: 1000, progress: 0.5 })
    const layout = computeLayout(info)
    const overflow = 1000 * LINE_HEIGHT - 300
    expect(layout.offset).toBe(overflow / 2)
    // At the halfway point the minimap shows the middle of the file, not
    // the top of it.
    expect(layout.firstLine).toBeGreaterThan(400)
  })

  it('lands exactly on the end of the document at full scroll', () => {
    const layout = computeLayout(viewport({ lines: 1000, progress: 1 }))
    expect(layout.lastLine).toBe(1000)
  })

  it('clamps a nonsense scroll fraction rather than drawing off-canvas', () => {
    expect(computeLayout(viewport({ lines: 1000, progress: -3 })).offset).toBe(0)
    expect(computeLayout(viewport({ lines: 1000, progress: Number.NaN })).offset).toBe(0)
    const full = computeLayout(viewport({ lines: 1000, progress: 4 }))
    expect(full.offset).toBe(1000 * LINE_HEIGHT - 300)
  })

  it('never asks for a line the document does not have', () => {
    const layout = computeLayout(viewport({ lines: 3 }))
    expect(layout.firstLine).toBe(1)
    expect(layout.lastLine).toBe(3)
  })
})

describe('computeSlider', () => {
  it('covers the lines the editor is showing', () => {
    const info = viewport({ topLine: 11, bottomLine: 30 })
    const slider = computeSlider(info, computeLayout(info))
    expect(slider.top).toBe(10 * LINE_HEIGHT)
    expect(slider.height).toBe(20 * LINE_HEIGHT)
  })

  it('accounts for the scroll offset of the minimap itself', () => {
    const info = viewport({
      lines: 1000,
      topLine: 500,
      bottomLine: 520,
      progress: 0.5
    })
    const layout = computeLayout(info)
    const slider = computeSlider(info, layout)
    expect(slider.top).toBe(499 * LINE_HEIGHT - layout.offset)
  })
})

describe('lineAtY', () => {
  it('maps a click back to the line drawn there', () => {
    const info = viewport()
    const layout = computeLayout(info)
    expect(lineAtY(0, layout, info.lines)).toBe(1)
    expect(lineAtY(LINE_HEIGHT * 9 + 1, layout, info.lines)).toBe(10)
  })

  it('stays inside the document at either edge', () => {
    const info = viewport({ lines: 20 })
    const layout = computeLayout(info)
    expect(lineAtY(-500, layout, info.lines)).toBe(1)
    expect(lineAtY(99999, layout, info.lines)).toBe(20)
  })

  it('is the inverse of the offset the layout applied', () => {
    const info = viewport({ lines: 1000, progress: 0.5 })
    const layout = computeLayout(info)
    // Whatever line is drawn at y=0 is the line a click at y=0 selects.
    expect(lineAtY(0, layout, info.lines)).toBe(layout.firstLine)
  })
})

describe('tokenizeLine', () => {
  it('skips whitespace so indentation shows as indentation', () => {
    const runs = tokenizeLine('    hello')
    expect(runs).toHaveLength(1)
    expect(runs[0].from).toBe(4)
    expect(runs[0].to).toBe(9)
  })

  it('marks macros apart from prose', () => {
    const runs = tokenizeLine('\\section{Results}')
    expect(runs[0]).toEqual({ from: 0, to: 8, kind: 'macro' })
    expect(runs.some((r) => r.kind === 'brace')).toBe(true)
    expect(runs.some((r) => r.kind === 'text')).toBe(true)
  })

  it('runs a comment to the end of the line', () => {
    const runs = tokenizeLine('text % a note about \\alpha')
    const comment = runs.find((r) => r.kind === 'comment')
    expect(comment).toBeDefined()
    expect(comment?.to).toBe(26)
    // Nothing after the % gets its own colour.
    expect(runs.filter((r) => r.kind === 'macro')).toHaveLength(0)
  })

  it('does not treat an escaped percent as a comment', () => {
    const runs = tokenizeLine('100\\% of it')
    expect(runs.some((r) => r.kind === 'comment')).toBe(false)
  })

  it('colours inline maths between the dollars', () => {
    const runs = tokenizeLine('let $x + y$ be')
    const math = runs.filter((r) => r.kind === 'math')
    expect(math.length).toBeGreaterThan(0)
    // The closing dollar ends it: the trailing word is prose again.
    expect(runs[runs.length - 1].kind).toBe('text')
  })

  it('gives up past the right-hand edge of the strip', () => {
    const runs = tokenizeLine('a'.repeat(MAX_COLUMNS + 500))
    expect(runs[runs.length - 1].to).toBeLessThanOrEqual(MAX_COLUMNS)
  })

  it('merges touching runs of the same kind', () => {
    // Two adjacent words separated only by a brace should not fragment the
    // prose into a rect per character.
    const runs = tokenizeLine('hello world')
    expect(runs).toHaveLength(2)
  })
})
