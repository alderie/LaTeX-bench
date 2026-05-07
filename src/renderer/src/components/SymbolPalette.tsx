import * as React from 'react'
import { useEffect, useState } from 'react'
import { useUiStore } from '../stores/uiStore'

interface Symbol {
  name: string
  latex: string
  /** Inline LaTeX that KaTeX can render for the preview. */
  preview: string
}

const SYMBOLS: { group: string; items: Symbol[] }[] = [
  {
    group: 'Greek',
    items: [
      { name: 'alpha', latex: '\\alpha', preview: '\\alpha' },
      { name: 'beta', latex: '\\beta', preview: '\\beta' },
      { name: 'gamma', latex: '\\gamma', preview: '\\gamma' },
      { name: 'Gamma', latex: '\\Gamma', preview: '\\Gamma' },
      { name: 'delta', latex: '\\delta', preview: '\\delta' },
      { name: 'Delta', latex: '\\Delta', preview: '\\Delta' },
      { name: 'epsilon', latex: '\\epsilon', preview: '\\epsilon' },
      { name: 'theta', latex: '\\theta', preview: '\\theta' },
      { name: 'lambda', latex: '\\lambda', preview: '\\lambda' },
      { name: 'mu', latex: '\\mu', preview: '\\mu' },
      { name: 'pi', latex: '\\pi', preview: '\\pi' },
      { name: 'sigma', latex: '\\sigma', preview: '\\sigma' },
      { name: 'phi', latex: '\\phi', preview: '\\phi' },
      { name: 'omega', latex: '\\omega', preview: '\\omega' }
    ]
  },
  {
    group: 'Operators',
    items: [
      { name: 'sum', latex: '\\sum', preview: '\\sum' },
      { name: 'prod', latex: '\\prod', preview: '\\prod' },
      { name: 'int', latex: '\\int', preview: '\\int' },
      { name: 'oint', latex: '\\oint', preview: '\\oint' },
      { name: 'partial', latex: '\\partial', preview: '\\partial' },
      { name: 'nabla', latex: '\\nabla', preview: '\\nabla' },
      { name: 'infty', latex: '\\infty', preview: '\\infty' },
      { name: 'pm', latex: '\\pm', preview: '\\pm' },
      { name: 'mp', latex: '\\mp', preview: '\\mp' },
      { name: 'cdot', latex: '\\cdot', preview: '\\cdot' },
      { name: 'times', latex: '\\times', preview: '\\times' },
      { name: 'div', latex: '\\div', preview: '\\div' }
    ]
  },
  {
    group: 'Relations',
    items: [
      { name: 'leq', latex: '\\leq', preview: '\\leq' },
      { name: 'geq', latex: '\\geq', preview: '\\geq' },
      { name: 'neq', latex: '\\neq', preview: '\\neq' },
      { name: 'approx', latex: '\\approx', preview: '\\approx' },
      { name: 'sim', latex: '\\sim', preview: '\\sim' },
      { name: 'in', latex: '\\in', preview: '\\in' },
      { name: 'subset', latex: '\\subset', preview: '\\subset' },
      { name: 'supset', latex: '\\supset', preview: '\\supset' },
      { name: 'forall', latex: '\\forall', preview: '\\forall' },
      { name: 'exists', latex: '\\exists', preview: '\\exists' }
    ]
  },
  {
    group: 'Arrows',
    items: [
      { name: 'rightarrow', latex: '\\rightarrow', preview: '\\rightarrow' },
      { name: 'leftarrow', latex: '\\leftarrow', preview: '\\leftarrow' },
      { name: 'Rightarrow', latex: '\\Rightarrow', preview: '\\Rightarrow' },
      { name: 'Leftarrow', latex: '\\Leftarrow', preview: '\\Leftarrow' },
      { name: 'leftrightarrow', latex: '\\leftrightarrow', preview: '\\leftrightarrow' },
      { name: 'mapsto', latex: '\\mapsto', preview: '\\mapsto' }
    ]
  },
  {
    group: 'Macros',
    items: [
      { name: 'frac', latex: '\\frac{}{}', preview: '\\frac{a}{b}' },
      { name: 'sqrt', latex: '\\sqrt{}', preview: '\\sqrt{x}' },
      { name: 'sum-limits', latex: '\\sum_{i=1}^{n}', preview: '\\sum_{i=1}^{n}' },
      { name: 'int-limits', latex: '\\int_{a}^{b}', preview: '\\int_{a}^{b}' },
      { name: 'lim', latex: '\\lim_{x \\to 0}', preview: '\\lim_{x \\to 0}' }
    ]
  }
]

export function SymbolPalette(): React.JSX.Element | null {
  const open = useUiStore((s) => s.symbolPaletteOpen)
  const setOpen = useUiStore((s) => s.setSymbolPaletteOpen)
  type KatexLib = { render: (tex: string, el: HTMLElement, opts?: any) => void }
  const [katexLib, setKatexLib] = useState<KatexLib | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    void import('katex').then((m) => {
      // katex's CJS shim exports the namespace at the top level; the ESM
      // build exposes it as `default`. Either way it has `.render`.
      setKatexLib(((m as any).default ?? m) as KatexLib)
    })
  }, [open])

  if (!open) return null

  const close = (): void => setOpen(false)

  const insert = (latex: string): void => {
    // Insert into the focused element (CodeMirror or textarea or PM editor).
    // We do this by simulating a paste — the simplest cross-editor path.
    const el = document.activeElement as HTMLElement | null
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      const ta = el as HTMLInputElement | HTMLTextAreaElement
      const start = ta.selectionStart ?? ta.value.length
      const end = ta.selectionEnd ?? start
      const next = ta.value.slice(0, start) + latex + ta.value.slice(end)
      ta.value = next
      ta.selectionStart = ta.selectionEnd = start + latex.length
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      close()
      return
    }
    // CodeMirror — use the EditorView via the cm-editor element.
    const cmEditor = document.querySelector('.cm-editor') as HTMLElement | null
    if (cmEditor) {
      // CodeMirror exposes EditorView on the DOM via internal property; the
      // simplest portable fallback is to dispatch a DataTransfer paste.
      const cmContent = cmEditor.querySelector('.cm-content') as HTMLElement | null
      if (cmContent) {
        cmContent.focus()
        document.execCommand('insertText', false, latex)
        close()
        return
      }
    }
    // ProseMirror — use the contenteditable selection.
    const pm = document.querySelector('.ProseMirror') as HTMLElement | null
    if (pm) {
      pm.focus()
      document.execCommand('insertText', false, latex)
    }
    close()
  }

  const lc = query.toLowerCase()

  return (
    <div className="symbol-palette__backdrop" onClick={close}>
      <div className="symbol-palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter symbols (alpha, sum, frac…)"
          className="symbol-palette__input"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        />
        <div className="symbol-palette__groups">
          {SYMBOLS.map((g) => {
            const items = g.items.filter(
              (s) => !lc || s.name.toLowerCase().includes(lc) || s.latex.toLowerCase().includes(lc)
            )
            if (items.length === 0) return null
            return (
              <div key={g.group} className="symbol-palette__group">
                <div className="symbol-palette__group-heading">{g.group}</div>
                <div className="symbol-palette__grid">
                  {items.map((s) => (
                    <button
                      key={s.name}
                      className="symbol-palette__cell"
                      title={s.latex}
                      onClick={() => insert(s.latex)}
                      ref={(el) => {
                        if (!el || !katexLib) return
                        try {
                          katexLib.render(s.preview, el.querySelector('.symbol-palette__preview')!, {
                            throwOnError: false,
                            displayMode: false
                          })
                        } catch {
                          /* fall back to raw text */
                        }
                      }}
                    >
                      <span className="symbol-palette__preview" />
                      <span className="symbol-palette__name">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
