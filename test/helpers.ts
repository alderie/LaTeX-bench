import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { Node as PMNode } from 'prosemirror-model'

const here = dirname(fileURLToPath(import.meta.url))

export function fixture(name: string): string {
  return readFileSync(join(here, 'fixtures', name), 'utf-8')
}

/**
 * Walk a ProseMirror doc and return a flat list of `nodeName` for each
 * non-text descendant. Useful for asserting "the structure looks like
 * [preamble, section, paragraph, mathBlock, …]" without depending on
 * inline text content.
 */
export function nodeOutline(doc: PMNode): string[] {
  const out: string[] = []
  doc.descendants((node) => {
    if (node.isText) return false
    out.push(node.type.name)
    return true
  })
  return out
}

/**
 * Concatenate all text leaves under a node (with marks ignored). Lets
 * tests assert visible content without caring about which marks are
 * attached at what depth.
 */
export function flatText(node: PMNode): string {
  let out = ''
  node.descendants((n) => {
    if (n.isText) out += n.text ?? ''
    return true
  })
  return out
}

/** Find the first descendant of a given node type. */
export function firstOfType(doc: PMNode, type: string): PMNode | null {
  let found: PMNode | null = null
  doc.descendants((n) => {
    if (found) return false
    if (n.type.name === type) {
      found = n
      return false
    }
    return true
  })
  return found
}

/** All descendants of a given type. */
export function allOfType(doc: PMNode, type: string): PMNode[] {
  const out: PMNode[] = []
  doc.descendants((n) => {
    if (n.type.name === type) out.push(n)
    return true
  })
  return out
}
