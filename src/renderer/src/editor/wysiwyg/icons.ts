// Icons for the parts of the editor that are built from plain DOM.
//
// The React chrome uses `lucide-react` components directly. The slash menu
// and the formula editor are ProseMirror node views and plugins — plain DOM,
// deliberately, so they can follow the caret without a React render between
// keystroke and paint. They still need to look like the rest of the app, so
// this module holds the same glyphs as element data and builds them with
// `createElementNS`.
//
// Geometry is lucide's (ISC licensed, and already a dependency of this
// project) on the same 24×24 grid with the same 1.5 stroke, so an icon from
// here and an icon from `lucide-react` sitting in the same row are
// indistinguishable.

type Attrs = Record<string, string>
type Shape = [tag: string, attrs: Attrs]

const ICONS: Record<string, Shape[]> = {
  sigma: [
    [
      'path',
      {
        d: 'M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2'
      }
    ]
  ],
  function: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
    ['path', { d: 'M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3' }],
    ['path', { d: 'M9 11.2h5.7' }]
  ],
  parentheses: [
    ['path', { d: 'M8 21s-4-3-4-9 4-9 4-9' }],
    ['path', { d: 'M16 3s4 3 4 9-4 9-4 9' }]
  ],
  brackets: [
    ['path', { d: 'M16 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3' }],
    ['path', { d: 'M8 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3' }]
  ],
  braces: [
    ['path', { d: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1' }],
    ['path', { d: 'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1' }]
  ],
  equal: [
    ['path', { d: 'M5 9h14' }],
    ['path', { d: 'M5 15h14' }]
  ],
  radical: [
    ['path', { d: 'M7 12h2l2 5 2-10h4' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }]
  ],
  grid: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M3 15h18' }],
    ['path', { d: 'M9 3v18' }],
    ['path', { d: 'M15 3v18' }]
  ],
  grid2: [
    ['path', { d: 'M12 3v18' }],
    ['path', { d: 'M3 12h18' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }]
  ],
  table: [
    ['path', { d: 'M12 3v18' }],
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M3 15h18' }]
  ],
  image: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }]
  ],
  code: [
    ['path', { d: 'm16 18 6-6-6-6' }],
    ['path', { d: 'm8 6-6 6 6 6' }]
  ],
  list: [
    ['path', { d: 'M3 5h.01' }],
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 19h.01' }],
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 19h13' }]
  ],
  listOrdered: [
    ['path', { d: 'M11 5h10' }],
    ['path', { d: 'M11 12h10' }],
    ['path', { d: 'M11 19h10' }],
    ['path', { d: 'M4 4h1v5' }],
    ['path', { d: 'M4 9h2' }],
    ['path', { d: 'M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02' }]
  ],
  listTree: [
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M13 12h8' }],
    ['path', { d: 'M13 19h8' }],
    ['path', { d: 'M3 10a2 2 0 0 0 2 2h3' }],
    ['path', { d: 'M3 5v12a2 2 0 0 0 2 2h3' }]
  ],
  superscript: [
    ['path', { d: 'm4 19 8-8' }],
    ['path', { d: 'm12 19-8-8' }],
    [
      'path',
      {
        d: 'M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06'
      }
    ]
  ],
  quote: [
    ['path', { d: 'M17 5H3' }],
    ['path', { d: 'M21 12H8' }],
    ['path', { d: 'M21 19H8' }],
    ['path', { d: 'M3 12v7' }]
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  book: [
    ['path', { d: 'M10 2v8l3-3 3 3V2' }],
    ['path', { d: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20' }]
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }]
  ],
  rows: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M21 9H3' }],
    ['path', { d: 'M21 15H3' }]
  ],
  columns: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M9 3v18' }],
    ['path', { d: 'M15 3v18' }]
  ],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  enter: [
    ['path', { d: 'M20 4v7a4 4 0 0 1-4 4H4' }],
    ['path', { d: 'm9 10-5 5 5 5' }]
  ],
  // A label is an identifier, so it gets the identifier glyph rather than
  // the asterisk this used to be — `*` reads as a footnote marker.
  tag: [
    ['path', { d: 'M4 9h16' }],
    ['path', { d: 'M4 15h16' }],
    ['path', { d: 'M10 3 8 21' }],
    ['path', { d: 'M16 3l-2 18' }]
  ]
}

export type IconName = keyof typeof ICONS

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Build an icon element.
 *
 * `aria-hidden` throughout: every icon here sits beside its own label, so a
 * screen reader announcing the glyph would just read the name twice.
 */
export function createIcon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value)
    svg.appendChild(shape)
  }
  return svg
}

export function hasIcon(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}
