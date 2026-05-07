import { Schema, NodeSpec, MarkSpec } from 'prosemirror-model'

// A small ProseMirror schema that approximates a LaTeX article. Anything
// outside this set survives in a `rawLatex` block whose verbatim source
// is round-tripped through the AST.
//
//   doc
//     preamble?              raw latex before \begin{document}
//     section+               (level 1..3)
//       paragraph | mathBlock | figure | rawLatex | listBlock
//
// Inline atoms: mathInline, citation, crossRef. Marks: em, strong, code.

const nodes: { [name: string]: NodeSpec } = {
  doc: { content: 'block+' },

  preamble: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { source: { default: '' } },
    parseDOM: [
      {
        tag: 'div[data-preamble]',
        getAttrs: (dom) => ({ source: (dom as HTMLElement).dataset.source ?? '' })
      }
    ],
    toDOM: (node) => ['div', { 'data-preamble': '', 'data-source': node.attrs.source as string }, '']
  },

  section: {
    group: 'block',
    content: 'sectionTitle (block | section)*',
    defining: true,
    attrs: {
      id: { default: '' },
      level: { default: 1 } // 1=section, 2=subsection, 3=subsubsection
    },
    parseDOM: [
      {
        tag: 'section',
        getAttrs: (dom) => ({
          id: (dom as HTMLElement).id || '',
          level: Number((dom as HTMLElement).dataset.level ?? '1')
        })
      }
    ],
    toDOM: (node) => [
      'section',
      { id: node.attrs.id as string, 'data-level': String(node.attrs.level) },
      0
    ]
  },

  sectionTitle: {
    content: 'inline*',
    defining: true,
    attrs: { level: { default: 1 } },
    parseDOM: [
      {
        tag: 'h1',
        attrs: { level: 1 }
      },
      {
        tag: 'h2',
        attrs: { level: 2 }
      },
      {
        tag: 'h3',
        attrs: { level: 3 }
      }
    ],
    toDOM: (node) => [`h${Math.min(3, Math.max(1, node.attrs.level as number))}`, 0]
  },

  paragraph: {
    group: 'block',
    content: 'inline*',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0]
  },

  mathBlock: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      latex: { default: '' },
      label: { default: null as string | null }
    },
    parseDOM: [
      {
        tag: 'div[data-math-block]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            latex: el.dataset.latex ?? '',
            label: el.dataset.label || null
          }
        }
      }
    ],
    toDOM: (node) => [
      'div',
      {
        'data-math-block': '',
        'data-latex': node.attrs.latex as string,
        ...(node.attrs.label ? { 'data-label': node.attrs.label as string } : {})
      },
      ''
    ]
  },

  figure: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      src: { default: '' },
      caption: { default: '' },
      label: { default: null as string | null },
      width: { default: null as string | null }
    },
    parseDOM: [
      {
        tag: 'figure[data-figure]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            src: el.dataset.src ?? '',
            caption: el.dataset.caption ?? '',
            label: el.dataset.label || null,
            width: el.dataset.width || null
          }
        }
      }
    ],
    toDOM: (node) => [
      'figure',
      {
        'data-figure': '',
        'data-src': node.attrs.src as string,
        'data-caption': (node.attrs.caption as string) ?? '',
        ...(node.attrs.label ? { 'data-label': node.attrs.label as string } : {}),
        ...(node.attrs.width ? { 'data-width': node.attrs.width as string } : {})
      },
      ''
    ]
  },

  rawLatex: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { source: { default: '' } },
    parseDOM: [
      {
        tag: 'pre[data-raw-latex]',
        getAttrs: (dom) => ({ source: (dom as HTMLElement).textContent ?? '' })
      }
    ],
    toDOM: (node) => ['pre', { 'data-raw-latex': '' }, node.attrs.source as string]
  },

  listBlock: {
    group: 'block',
    content: 'listItem+',
    attrs: { kind: { default: 'itemize' } }, // 'itemize' | 'enumerate'
    parseDOM: [
      {
        tag: 'ul',
        attrs: { kind: 'itemize' }
      },
      {
        tag: 'ol',
        attrs: { kind: 'enumerate' }
      }
    ],
    toDOM: (node) => [node.attrs.kind === 'enumerate' ? 'ol' : 'ul', 0]
  },

  listItem: {
    content: 'paragraph (paragraph | listBlock)*',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0]
  },

  text: { group: 'inline' },

  mathInline: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: { latex: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-math-inline]',
        getAttrs: (dom) => ({ latex: (dom as HTMLElement).dataset.latex ?? '' })
      }
    ],
    toDOM: (node) => ['span', { 'data-math-inline': '', 'data-latex': node.attrs.latex as string }, '']
  },

  citation: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: { keys: { default: [] as string[] } },
    parseDOM: [
      {
        tag: 'span[data-citation]',
        getAttrs: (dom) => {
          const raw = (dom as HTMLElement).dataset.keys ?? ''
          return { keys: raw.split(',').filter(Boolean) }
        }
      }
    ],
    toDOM: (node) => [
      'span',
      { 'data-citation': '', 'data-keys': (node.attrs.keys as string[]).join(',') },
      ''
    ]
  },

  crossRef: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: { label: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-cross-ref]',
        getAttrs: (dom) => ({ label: (dom as HTMLElement).dataset.label ?? '' })
      }
    ],
    toDOM: (node) => ['span', { 'data-cross-ref': '', 'data-label': node.attrs.label as string }, '']
  }
}

const marks: { [name: string]: MarkSpec } = {
  em: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0]
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b' },
      { style: 'font-weight', getAttrs: (val) => /^(bold(er)?|[5-9]\d{2,})$/.test(val as string) && null }
    ],
    toDOM: () => ['strong', 0]
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0]
  }
}

export const latexSchema = new Schema({ nodes, marks })
