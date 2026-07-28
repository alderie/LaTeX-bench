import type { MissingPackage } from '../../shared/types'

// Which packages a paper needs, and how to notice when one is absent.
//
// Two halves of the same problem. `EXTRA_PACKAGES` is a guess, made once at
// install time, about what papers written in this editor will reach for; it
// is a good guess and it will always be wrong for somebody. So the second
// half reads the compile log for the file TeX could not find and names the
// package that provides it, which is what turns "Emergency stop" into a
// button.

/**
 * What gets installed beyond the base scheme.
 *
 * `scheme-basic` is LaTeX and nothing else, which compiles almost no real
 * paper. This is the set a paper in this editor actually reaches for: the
 * default engine, the packages the starter document loads, and the ones
 * every template in the wild assumes are present. Roughly 250MB installed —
 * a fraction of a full TeX Live, and enough that the first compile works.
 *
 * This list being incomplete is expected rather than a bug — anything left
 * out is recoverable through `missingPackagesFromLog` and the build panel.
 */
export const EXTRA_PACKAGES = [
  'latexmk',
  'hyperref',
  'amsfonts',
  'booktabs',
  'caption',
  'natbib',
  'microtype',
  'xcolor',
  'geometry',
  'enumitem',
  // No `subcaption` — it ships inside `caption`, and asking tlmgr for it by
  // name fails the whole install step.
  'float',
  'wrapfig',
  'listings',
  'algorithms',
  'algorithmicx',
  'cleveref',
  'multirow',
  'ulem',
  'setspace',
  'titlesec',
  'lipsum',
  // `mathtools` is amsmath's companion and `pgf` is what `\usepackage{tikz}`
  // resolves to. Both were missing here, and between them they are most of
  // what a maths or CS paper loads after amsmath itself — a figure drawn in
  // TikZ and a `\coloneqq` are not exotic.
  'mathtools',
  'pgf',
  // The modern bibliography stack. The editor reads `references.bib` and
  // completes from it, so the tools that consume one belong in the base
  // install rather than being a thing you discover you're missing.
  'biblatex',
  'biber'
]

/**
 * Files whose provider is not simply the filename.
 *
 * The common case — `mathtools.sty` living in the `mathtools` package — needs
 * no entry. These are the ones where guessing gets it wrong, and asking tlmgr
 * for a name it doesn't have is a dead end rather than a slow path.
 */
const FILE_TO_PACKAGE: Record<string, string> = {
  'tikz.sty': 'pgf',
  'pgfplots.sty': 'pgfplots',
  'algorithm.sty': 'algorithms',
  'algorithmic.sty': 'algorithms',
  'algpseudocode.sty': 'algorithmicx',
  'algorithmicx.sty': 'algorithmicx',
  'subcaption.sty': 'caption',
  'lmodern.sty': 'lm',
  'epstopdf.sty': 'epstopdf-pkg',
  'inputenc.sty': 'latex',
  'fontenc.sty': 'latex',
  'amsmath.sty': 'amsmath',
  'amssymb.sty': 'amsfonts',
  'amsthm.sty': 'amscls',
  'siunitx.sty': 'siunitx',
  'todonotes.sty': 'todonotes',
  'authblk.sty': 'preprint',
  'orcidlink.sty': 'orcidlink'
}

/** Extensions worth offering to install. A missing `.tex` is the user's own. */
const PROVIDED_BY_A_PACKAGE = /\.(sty|cls|clo|def|fd|code\.tex)$/i

/**
 * The file TeX gave up on, in every wording it uses.
 *
 * Matched against the whole log rather than line by line: TeX hard-wraps its
 * log at 79 columns and will break mid-message, so the newline has to be
 * allowed to fall anywhere — including inside the quoted filename, which is
 * why the capture is stripped of whitespace afterwards.
 */
const MISSING_FILE_RE = /File\s+[`'"]([^'"`]+?)['"`]\s+not\s+found/g

/**
 * Packages the log says are missing, in the order TeX hit them.
 *
 * Note that a compile stops at the *first* missing file, so this normally
 * returns one entry even when a document is short several packages. That is
 * a property of TeX rather than of this function, and it means installing
 * what it reports and rebuilding may need to happen more than once.
 */
export function missingPackagesFromLog(log: string): MissingPackage[] {
  const found: MissingPackage[] = []
  const seen = new Set<string>()

  for (const match of log.matchAll(MISSING_FILE_RE)) {
    const file = match[1].replace(/\s+/g, '')
    if (!PROVIDED_BY_A_PACKAGE.test(file)) continue
    const name = packageForFile(file)
    if (!name || seen.has(name)) continue
    seen.add(name)
    found.push({ file, name })
  }
  return found
}

/** The TeX Live package that provides `file`, or null if we can't tell. */
export function packageForFile(file: string): string | null {
  const known = FILE_TO_PACKAGE[file.toLowerCase()]
  if (known) return known

  // Every TikZ library is a `tikzlibrary*.code.tex` inside pgf, and there are
  // far too many to enumerate.
  if (/^(tikzlibrary|pgflibrary|pgfsys)/i.test(file)) return 'pgf'

  const stem = file.replace(PROVIDED_BY_A_PACKAGE, '')
  // A stem that isn't a plausible package name is better reported as unknown
  // than sent to tlmgr, which would fail the whole install for the one bad
  // name and take any good ones down with it.
  return /^[a-z0-9][a-z0-9._-]*$/i.test(stem) ? stem : null
}
