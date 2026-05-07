// Schemas for the MCP tools the paper editor exposes. Kept here (not in
// mcp-server.ts) so they can be unit-tested without spinning up Express.

export const toolDefinitions = [
  {
    name: 'list_papers',
    description: 'List all papers in the local library with their titles and last-modified timestamps.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'read_paper',
    description: 'Read the full LaTeX source of a paper.',
    inputSchema: {
      type: 'object',
      properties: { paperId: { type: 'string' } },
      required: ['paperId'],
      additionalProperties: false
    }
  },
  {
    name: 'list_sections',
    description:
      'List all section/subsection/subsubsection headings in a paper with their line ranges.',
    inputSchema: {
      type: 'object',
      properties: { paperId: { type: 'string' } },
      required: ['paperId'],
      additionalProperties: false
    }
  },
  {
    name: 'read_section',
    description:
      'Read the LaTeX source of one section, addressed by the offset returned by list_sections.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string' },
        sectionOffset: {
          type: 'integer',
          description: 'Character offset of the \\section macro (from list_sections.offset).'
        }
      },
      required: ['paperId', 'sectionOffset'],
      additionalProperties: false
    }
  },
  {
    name: 'update_section',
    description:
      'Replace one section in a paper. The new LaTeX must include its own \\section{...} (or \\subsection / \\subsubsection) macro at the start.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string' },
        sectionOffset: { type: 'integer' },
        latex: { type: 'string' }
      },
      required: ['paperId', 'sectionOffset', 'latex'],
      additionalProperties: false
    }
  },
  {
    name: 'replace_range',
    description:
      'Replace a character-range slice of a paper with new LaTeX. Use this for fine-grained edits or when you want to insert content somewhere other than at a section boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string' },
        from: { type: 'integer' },
        to: { type: 'integer' },
        latex: { type: 'string' }
      },
      required: ['paperId', 'from', 'to', 'latex'],
      additionalProperties: false
    }
  },
  {
    name: 'append_to_paper',
    description: 'Append new LaTeX to the body of the paper, immediately before \\end{document}.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string' },
        latex: { type: 'string' }
      },
      required: ['paperId', 'latex'],
      additionalProperties: false
    }
  },
  {
    name: 'read_references',
    description: 'Read references.bib for a paper.',
    inputSchema: {
      type: 'object',
      properties: { paperId: { type: 'string' } },
      required: ['paperId'],
      additionalProperties: false
    }
  },
  {
    name: 'add_reference',
    description: 'Append a BibTeX entry to references.bib.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string' },
        bibtex: { type: 'string' }
      },
      required: ['paperId', 'bibtex'],
      additionalProperties: false
    }
  },
  {
    name: 'compile',
    description: 'Compile the paper to PDF and return success/failure plus the parsed log.',
    inputSchema: {
      type: 'object',
      properties: { paperId: { type: 'string' } },
      required: ['paperId'],
      additionalProperties: false
    }
  },
  {
    name: 'search',
    description: 'Search across all papers (or one paper) for a substring or regex match.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string' },
        query: { type: 'string' },
        regex: { type: 'boolean' }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
] as const
