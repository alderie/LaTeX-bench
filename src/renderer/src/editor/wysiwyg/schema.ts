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
    // sectionTitle is required; everything after is regular block content
    // (paragraphs, math, theorem callouts, bibliography, nested sections, …).
    content: 'sectionTitle (block | section)*',
    defining: true,
    attrs: {
      id: { default: '' },
      level: { default: 1 }, // 1=section, 2=subsection, 3=subsubsection
      starred: { default: false }, // \section* — no number
      labels: { default: [] as string[] }
    },
    parseDOM: [
      {
        tag: 'section',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const labels = el.dataset.labels
          return {
            id: el.id || '',
            level: Number(el.dataset.level ?? '1'),
            starred: el.dataset.starred === '1',
            labels: labels ? labels.split(',').filter(Boolean) : []
          }
        }
      }
    ],
    toDOM: (node) => {
      const labels = node.attrs.labels as string[]
      // First label wins as the navigable anchor. Fall back to the
      // slug-based id (set at parse time) so old behaviour is preserved
      // for sections without labels.
      const anchorId =
        labels.length > 0
          ? `latex-anchor-${labels[0].replace(/[^a-zA-Z0-9_-]/g, '-')}`
          : (node.attrs.id as string)
      return [
        'section',
        {
          id: anchorId,
          'data-level': String(node.attrs.level),
          ...(node.attrs.starred ? { 'data-starred': '1' } : {}),
          ...(labels.length > 0 ? { 'data-labels': labels.join(',') } : {})
        },
        0
      ]
    }
  },

  sectionTitle: {
    content: 'inline*',
    defining: true,
    attrs: { level: { default: 1 } },
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 4 } },
      { tag: 'h5', attrs: { level: 5 } }
    ],
    // Levels 4/5 are \paragraph / \subparagraph — LaTeX renders them
    // run-in (bold lead-in on the same line as the body). The CSS keys
    // off data-level to reproduce that.
    toDOM: (node) => {
      const level = Math.min(5, Math.max(1, node.attrs.level as number))
      return [`h${level}`, { 'data-level': String(level) }, 0]
    }
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
      width: { default: null as string | null },
      // The `[htbp]` float placement, verbatim.
      placement: { default: '' }
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
            width: el.dataset.width || null,
            placement: el.dataset.placement ?? ''
          }
        }
      }
    ],
    toDOM: (node) => {
      const label = node.attrs.label as string | null
      return [
        'figure',
        {
          'data-figure': '',
          'data-src': node.attrs.src as string,
          'data-caption': (node.attrs.caption as string) ?? '',
          ...(node.attrs.placement ? { 'data-placement': node.attrs.placement as string } : {}),
          ...(label
            ? {
                'data-label': label,
                id: `latex-anchor-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
              }
            : {}),
          ...(node.attrs.width ? { 'data-width': node.attrs.width as string } : {})
        },
        ''
      ]
    }
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
    attrs: {
      kind: { default: 'itemize' }, // 'itemize' | 'enumerate' | 'description'
      // enumitem's `[…]` argument (`label=(\roman*)`, `leftmargin=*`, …)
      // kept verbatim so the list's appearance round-trips.
      options: { default: '' }
    },
    parseDOM: [
      {
        tag: 'ul',
        getAttrs: (dom) => ({
          kind: (dom as HTMLElement).dataset.kind || 'itemize',
          options: (dom as HTMLElement).dataset.options ?? ''
        })
      },
      {
        tag: 'ol',
        getAttrs: (dom) => ({
          kind: 'enumerate',
          options: (dom as HTMLElement).dataset.options ?? ''
        })
      },
      {
        tag: 'dl',
        getAttrs: (dom) => ({
          kind: 'description',
          options: (dom as HTMLElement).dataset.options ?? ''
        })
      }
    ],
    toDOM: (node) => {
      const kind = node.attrs.kind as string
      const tag = kind === 'enumerate' ? 'ol' : 'ul'
      return [
        tag,
        {
          'data-kind': kind,
          ...(node.attrs.options ? { 'data-options': node.attrs.options as string } : {})
        },
        0
      ]
    }
  },

  listItem: {
    content: 'paragraph (paragraph | listBlock)*',
    defining: true,
    // `\item[term]` in a description list (and enumitem's `[label]`
    // override elsewhere) — kept verbatim so it round-trips.
    attrs: { marker: { default: null as string | null } },
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (dom) => ({ marker: (dom as HTMLElement).dataset.marker || null })
      }
    ],
    toDOM: (node) => [
      'li',
      node.attrs.marker ? { 'data-marker': node.attrs.marker as string } : {},
      0
    ]
  },

  // Verbatim-ish code environments: verbatim, lstlisting, minted, alltt,
  // Verbatim (fancyvrb). The body is stored byte-exact so a round-trip is
  // lossless; `options` keeps the raw `[…]` argument (e.g. `language=Python`)
  // and `language` is the best-effort language name pulled out of it.
  codeBlock: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      code: { default: '' },
      env: { default: 'verbatim' },
      options: { default: '' },
      language: { default: '' }
    },
    parseDOM: [
      {
        tag: 'pre[data-code-block]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            code: el.textContent ?? '',
            env: el.dataset.env ?? 'verbatim',
            options: el.dataset.options ?? '',
            language: el.dataset.language ?? ''
          }
        }
      }
    ],
    toDOM: (node) => [
      'pre',
      {
        'data-code-block': '',
        'data-env': node.attrs.env as string,
        ...(node.attrs.options ? { 'data-options': node.attrs.options as string } : {}),
        ...(node.attrs.language ? { 'data-language': node.attrs.language as string } : {})
      },
      node.attrs.code as string
    ]
  },

  // A LaTeX float (`table`, `algorithm`, or a `figure` whose body is more
  // than a bare \includegraphics). Unlike the atom `figure` node this keeps
  // the body as real block content, so tikzpicture / tabular / algorithmic
  // payloads survive editing instead of being dropped on serialize.
  floatBlock: {
    group: 'block',
    content:
      '(caption | paragraph | mathBlock | listBlock | rawLatex | figureImage | codeBlock | floatBlock | figure | theoremEnv)+',
    defining: true,
    attrs: {
      kind: { default: 'table' }, // table | algorithm | figure | center | …
      // Everything between `\begin{kind}` and the body, verbatim and with
      // its delimiters — `[t]`, `[b]{0.5\linewidth}`, `{99}`. Kept as raw
      // text because these arguments are package-specific and re-printing
      // them from the AST rewrites them.
      args: { default: '' },
      label: { default: null as string | null },
      centering: { default: false }
    },
    parseDOM: [
      {
        tag: 'div[data-float]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            kind: el.dataset.kind ?? 'table',
            args: el.dataset.args ?? '',
            label: el.dataset.label || null,
            centering: el.dataset.centering === '1'
          }
        }
      }
    ],
    toDOM: (node) => {
      const label = node.attrs.label as string | null
      return [
        'div',
        {
          'data-float': '',
          class: 'float-block',
          'data-kind': node.attrs.kind as string,
          ...(node.attrs.args ? { 'data-args': node.attrs.args as string } : {}),
          ...(node.attrs.centering ? { 'data-centering': '1' } : {}),
          ...(label
            ? {
                'data-label': label,
                id: `latex-anchor-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
              }
            : {})
        },
        0
      ]
    }
  },

  // `\caption{…}` inside a float. Inline content so math in captions works.
  caption: {
    content: 'inline*',
    defining: true,
    attrs: { short: { default: null as string | null } },
    parseDOM: [{ tag: 'figcaption[data-caption]' }],
    toDOM: () => ['figcaption', { 'data-caption': '', class: 'float-block__caption' }, 0]
  },

  // A bare `\includegraphics` inside a float body. (The standalone `figure`
  // node above stays for simple single-image figures.)
  figureImage: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      src: { default: '' },
      width: { default: null as string | null },
      options: { default: '' }
    },
    parseDOM: [
      {
        tag: 'img[data-figure-image]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            src: el.dataset.src ?? '',
            width: el.dataset.width || null,
            options: el.dataset.options ?? ''
          }
        }
      }
    ],
    toDOM: (node) => [
      'img',
      {
        'data-figure-image': '',
        'data-src': node.attrs.src as string,
        ...(node.attrs.width ? { 'data-width': node.attrs.width as string } : {}),
        ...(node.attrs.options ? { 'data-options': node.attrs.options as string } : {})
      }
    ]
  },

  // Theorem-like environments (theorem, lemma, definition, proposition,
  // corollary, remark, example, assumption, proof). Rendered as a callout
  // with a coloured rule + bold "kind" label, body holds normal block
  // content (paragraphs, math, lists). Round-trips by re-emitting
  // \begin{kind}[title] ... \end{kind}.
  theoremEnv: {
    group: 'block',
    content: '(paragraph | mathBlock | listBlock | rawLatex | figure | codeBlock | floatBlock | figureImage)+',
    defining: true,
    attrs: {
      kind: { default: 'theorem' },
      label: { default: null as string | null },
      title: { default: null as string | null }
    },
    parseDOM: [
      {
        tag: 'aside[data-theorem]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            kind: el.dataset.kind ?? 'theorem',
            label: el.dataset.label || null,
            title: el.dataset.title || null
          }
        }
      }
    ],
    toDOM: (node) => {
      const label = node.attrs.label as string | null
      return [
        'aside',
        {
          'data-theorem': '',
          'data-kind': node.attrs.kind as string,
          ...(label
            ? {
                'data-label': label,
                id: `latex-anchor-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
              }
            : {}),
          ...(node.attrs.title ? { 'data-title': node.attrs.title as string } : {})
        },
        0
      ]
    }
  },

  // \begin{thebibliography}{99} ... \end{thebibliography} — a list of
  // \bibitem{key} entries. Rendered with copy-key affordances; entries
  // are first-class so the user can edit them inline rather than as
  // raw LaTeX text.
  bibliography: {
    group: 'block',
    content: 'bibitem*',
    attrs: { widestLabel: { default: '' } },
    parseDOM: [
      {
        tag: 'section[data-bibliography]',
        getAttrs: (dom) => ({
          widestLabel: (dom as HTMLElement).dataset.widestLabel ?? ''
        })
      }
    ],
    toDOM: (node) => [
      'section',
      {
        'data-bibliography': '',
        'data-widest-label': node.attrs.widestLabel as string
      },
      0
    ]
  },

  bibitem: {
    content: 'inline*',
    attrs: {
      key: { default: '' },
      label: { default: null as string | null }
    },
    parseDOM: [
      {
        tag: 'div[data-bibitem]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            key: el.dataset.key ?? '',
            label: el.dataset.label || null
          }
        }
      }
    ],
    toDOM: (node) => {
      const key = node.attrs.key as string
      return [
        'div',
        {
          'data-bibitem': '',
          'data-key': key,
          ...(key
            ? { id: `latex-anchor-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}` }
            : {}),
          ...(node.attrs.label ? { 'data-label': node.attrs.label as string } : {})
        },
        0
      ]
    }
  },

  // ── Title block ────────────────────────────────────────────────
  // Renders the document's title, author list, and date as an
  // editable structure. \title/\author/\date are lifted out of the
  // preamble at parse time and a `titleBlock` is inserted at the
  // position of \maketitle. On serialize, the metadata is re-emitted
  // into the preamble and a literal `\maketitle` written at the block
  // position. \and inside \author starts a new authorEntry; `\\` is a
  // hard line break (`hardBreak`).
  titleBlock: {
    group: 'block',
    content: 'titleHeading authorList? titleDate?',
    defining: true,
    parseDOM: [{ tag: 'div[data-title-block]' }],
    toDOM: () => ['div', { 'data-title-block': '' }, 0]
  },
  titleHeading: {
    content: 'inline*',
    defining: true,
    parseDOM: [{ tag: 'h1[data-title-heading]' }],
    toDOM: () => ['h1', { 'data-title-heading': '', class: 'title-block__title' }, 0]
  },
  authorList: {
    content: 'authorEntry+',
    parseDOM: [{ tag: 'div[data-author-list]' }],
    toDOM: () => ['div', { 'data-author-list': '', class: 'title-block__authors' }, 0]
  },
  authorEntry: {
    content: 'inline*',
    parseDOM: [{ tag: 'div[data-author-entry]' }],
    toDOM: () => ['div', { 'data-author-entry': '', class: 'title-block__author' }, 0]
  },
  titleDate: {
    content: 'inline*',
    attrs: { kind: { default: 'literal' } }, // 'today' | 'literal'
    parseDOM: [
      {
        tag: 'div[data-title-date]',
        getAttrs: (dom) => ({
          kind: (dom as HTMLElement).dataset.kind || 'literal'
        })
      }
    ],
    toDOM: (node) => [
      'div',
      {
        'data-title-date': '',
        'data-kind': node.attrs.kind as string,
        class: 'title-block__date'
      },
      0
    ]
  },

  text: { group: 'inline' },

  hardBreak: {
    group: 'inline',
    inline: true,
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br']
  },

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

  // `\footnote{…}` / `\thanks{…}`. The body is kept as raw LaTeX on the
  // node so it round-trips byte-for-byte; the node view renders a
  // superscript marker plus a hover popover with the rendered text.
  footnote: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: {
      source: { default: '' },
      cmd: { default: 'footnote' } // 'footnote' | 'thanks' | 'footnotetext'
    },
    parseDOM: [
      {
        tag: 'sup[data-footnote]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return { source: el.dataset.source ?? '', cmd: el.dataset.cmd ?? 'footnote' }
        }
      }
    ],
    toDOM: (node) => [
      'sup',
      {
        'data-footnote': '',
        'data-source': node.attrs.source as string,
        'data-cmd': node.attrs.cmd as string
      },
      ''
    ]
  },

  // An inline macro we can't model but must not lose (`\verb|…|`, an
  // unknown zero-arg macro, …). Renders as its literal source.
  rawInline: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: {
      source: { default: '' }, // exact LaTeX to re-emit
      display: { default: '' } // what to show in the WYSIWYG view
    },
    parseDOM: [
      {
        tag: 'span[data-raw-inline]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return { source: el.dataset.source ?? '', display: el.textContent ?? '' }
        }
      }
    ],
    toDOM: (node) => [
      'span',
      { 'data-raw-inline': '', 'data-source': node.attrs.source as string },
      node.attrs.display as string
    ]
  },

  citation: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: {
      keys: { default: [] as string[] },
      // Which cite command this came from, so `\citep`/`\citet`/`\parencite`
      // survive a round-trip instead of collapsing to plain `\cite`.
      cmd: { default: 'cite' },
      // natbib/biblatex optional notes: `\citep[see][p.~4]{key}`.
      prenote: { default: null as string | null },
      postnote: { default: null as string | null }
    },
    parseDOM: [
      {
        tag: 'span[data-citation]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const raw = el.dataset.keys ?? ''
          return {
            keys: raw.split(',').filter(Boolean),
            cmd: el.dataset.cmd || 'cite',
            prenote: el.dataset.prenote ?? null,
            postnote: el.dataset.postnote ?? null
          }
        }
      }
    ],
    toDOM: (node) => [
      'span',
      {
        'data-citation': '',
        'data-keys': (node.attrs.keys as string[]).join(','),
        'data-cmd': node.attrs.cmd as string,
        ...(node.attrs.prenote !== null ? { 'data-prenote': node.attrs.prenote as string } : {}),
        ...(node.attrs.postnote !== null ? { 'data-postnote': node.attrs.postnote as string } : {})
      },
      ''
    ]
  },

  crossRef: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: {
      // Backwards-compat: single-label refs still populate `label`.
      label: { default: '' },
      // The full key list (cleveref `\cref{a,b,c}` form). When non-empty,
      // takes precedence over `label`.
      keys: { default: [] as string[] },
      // Which command this came from — controls the formatted output:
      //   ref     → "3.1"
      //   eqref   → "(1)"
      //   cref    → "Theorem 3.1"
      //   Cref    → "Theorem 3.1" (capitalised at start)
      //   pageref → page number (we render as "?"/key for now)
      //   autoref → kind + number, similar to cref
      cmd: { default: 'ref' }
    },
    parseDOM: [
      {
        tag: 'span[data-cross-ref]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const keys = el.dataset.keys
          return {
            label: el.dataset.label ?? '',
            keys: keys ? keys.split(',').filter(Boolean) : [],
            cmd: el.dataset.cmd ?? 'ref'
          }
        }
      }
    ],
    toDOM: (node) => [
      'span',
      {
        'data-cross-ref': '',
        'data-label': node.attrs.label as string,
        'data-cmd': node.attrs.cmd as string,
        ...((node.attrs.keys as string[]).length > 0
          ? { 'data-keys': (node.attrs.keys as string[]).join(',') }
          : {})
      },
      ''
    ]
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
  },
  smallcaps: {
    parseDOM: [{ style: 'font-variant=small-caps' }],
    toDOM: () => ['span', { style: 'font-variant: small-caps' }, 0]
  },
  link: {
    attrs: { href: { default: '' } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => ({
          href: (dom as HTMLElement).getAttribute('href') ?? ''
        })
      }
    ],
    toDOM: (mark) => [
      'a',
      { href: mark.attrs.href as string, target: '_blank', rel: 'noreferrer' },
      0
    ]
  }
}

export const latexSchema = new Schema({ nodes, marks })
