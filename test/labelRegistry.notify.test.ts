import { describe, it, expect } from 'vitest'
import { parseLatexToDoc } from '@renderer/editor/wysiwyg/latex-to-doc'
import * as labelRegistry from '@renderer/editor/wysiwyg/labelRegistry'
import { latexSchema } from '@renderer/editor/wysiwyg/schema'

// Every math node view subscribes to the registry, and each notification
// re-runs KaTeX on its formula. So a notification that carries no new
// numbering isn't merely wasted work — in a paper with a hundred equations
// it's a hundred re-renders on a keystroke that changed a word of prose.

const DOC = String.raw`\documentclass{article}
\begin{document}
\section{One}\label{sec:one}
Some prose here.
\begin{equation}\label{eq:a}a = b\end{equation}
More prose.
\begin{equation}\label{eq:b}c = d\end{equation}
\end{document}
`

describe('label registry notifications', () => {
  it('does not notify when a rebuild produces identical numbering', async () => {
    const { doc } = await parseLatexToDoc(DOC)
    labelRegistry.rebuild(doc)

    let notifications = 0
    const unsubscribe = labelRegistry.subscribe(() => notifications++)
    labelRegistry.rebuild(doc)
    labelRegistry.rebuild(doc)
    unsubscribe()

    expect(notifications).toBe(0)
  })

  it('notifies when an equation number actually changes', async () => {
    const { doc } = await parseLatexToDoc(DOC)
    labelRegistry.rebuild(doc)
    expect(labelRegistry.getLabel('eq:b')?.eqrefText).toBe('(2)')

    let notifications = 0
    const unsubscribe = labelRegistry.subscribe(() => notifications++)

    // Insert an equation ahead of the others: everything after renumbers.
    const inserted = doc.copy(
      doc.content.addToStart(
        latexSchema.nodes.mathBlock.create({
          latex: '\\begin{equation}\\label{eq:zero}z = 0\\end{equation}',
          label: 'eq:zero'
        })
      )
    )
    labelRegistry.rebuild(inserted)
    unsubscribe()

    expect(notifications).toBe(1)
    expect(labelRegistry.getLabel('eq:b')?.eqrefText).toBe('(3)')
  })

  it('notifies when a label is added, even with the same count', async () => {
    const { doc } = await parseLatexToDoc(DOC)
    labelRegistry.rebuild(doc)

    let notifications = 0
    const unsubscribe = labelRegistry.subscribe(() => notifications++)
    const { doc: renamed } = await parseLatexToDoc(DOC.replace('eq:a', 'eq:renamed'))
    labelRegistry.rebuild(renamed)
    unsubscribe()

    expect(notifications).toBe(1)
    expect(labelRegistry.getLabel('eq:renamed')).toBeDefined()
    expect(labelRegistry.getLabel('eq:a')).toBeUndefined()
  })
})
