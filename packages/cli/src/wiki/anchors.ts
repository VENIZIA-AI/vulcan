import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AnchorProblems } from './constants.ts';
import type { TAnchorProblem } from './constants.ts';

/**
 * Every in-page anchor the wiki links to must exist on the page it names. The truth is the BUILT html:
 * VitePress does not slugify the way GitHub does (`Construction - Sentinel` is `construction-sentinel`
 * here), so a reimplemented slugifier reports working links as broken. Reading the emitted `id="..."`
 * removes the guess; the check needs a build.
 */
export interface IBrokenAnchor {
  file: string;
  line: number;
  target: string;
  reason: TAnchorProblem;
}

const walk = (opts: { directory: string; extension: string }): string[] =>
  readdirSync(opts.directory).flatMap((name) => {
    const full = join(opts.directory, name);

    if (statSync(full).isDirectory()) {
      return walk({ directory: full, extension: opts.extension });
    }

    return full.endsWith(opts.extension) ? [full] : [];
  });

/** `a/b.html` and `a/index.html` answer to `/a/b` and `/a`. */
const routeOf = (opts: { file: string; root: string; extension: string }): string => {
  const bare = opts.file.slice(opts.root.length + 1).slice(0, -opts.extension.length);

  return `/${bare.replace(/\/?index$/, '')}`.replace(/\/$/, '') || '/';
};

const normalizeRoute = (opts: { route: string }): string =>
  opts.route.replace(/\/?index$/, '').replace(/\/$/, '') || '/';

/** Resolves a link target - empty (same page), absolute or relative - to a dist route. */
const resolveRoute = (opts: { file: string; target: string; content: string }): string => {
  const { file, target, content } = opts;

  if (target === '') {
    return routeOf({ file, root: content, extension: '.md' });
  }

  const bare = target.replace(/\.md$/, '');

  if (bare.startsWith('/')) {
    return normalizeRoute({ route: bare });
  }

  const directory = file
    .slice(content.length + 1)
    .split('/')
    .slice(0, -1)
    .join('/');

  return normalizeRoute({ route: `/${join(directory, bare)}` });
};

const readAnchors = (opts: { dist: string }): Map<string, Set<string>> => {
  const anchorsByRoute = new Map<string, Set<string>>();

  for (const file of walk({ directory: opts.dist, extension: '.html' })) {
    const ids = new Set(
      [...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      ),
    );

    anchorsByRoute.set(routeOf({ file, root: opts.dist, extension: '.html' }), ids);
  }

  return anchorsByRoute;
};

/** Checks every `](page#fragment)` link of the markdown under `content` against the ids built in `dist`. */
export const checkAnchors = (opts: {
  content: string;
  dist: string;
}): { checked: number; broken: IBrokenAnchor[] } => {
  const { content } = opts;
  const anchorsByRoute = readAnchors({ dist: opts.dist });
  const broken: IBrokenAnchor[] = [];
  let checked = 0;

  for (const file of walk({ directory: content, extension: '.md' })) {
    // Fenced code carries example links that are not ours to resolve.
    const body = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, (match) =>
      match.replace(/[^\n]/g, ' '),
    );

    for (const [index, text] of body.split('\n').entries()) {
      for (const match of text.matchAll(/\]\(([^)\s]*?)#([\w.-]+)\)/g)) {
        const [, page = '', anchor = ''] = match;

        if (page.startsWith('http')) {
          continue;
        }

        checked += 1;

        const ids = anchorsByRoute.get(resolveRoute({ file, target: page, content }));
        const target = `${page}#${anchor}`;

        if (ids === undefined) {
          broken.push({ file, line: index + 1, target, reason: AnchorProblems.MISSING_PAGE });
        } else if (!ids.has(anchor)) {
          broken.push({ file, line: index + 1, target, reason: AnchorProblems.DEAD_ANCHOR });
        }
      }
    }
  }

  return { checked, broken };
};
