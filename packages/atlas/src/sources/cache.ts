import { homedir } from 'node:os';
import { join } from 'node:path';

/** The cache layout this atlas reads and writes (V2): a layout from another version is never read. */
const CACHE_LAYOUT = 'v1';

/** `owner/repo` is GitHub's; anything with a scheme (or a path) is a git URL as given. */
export const urlOf = (opts: { repo: string }): string =>
  /^[\w.-]+\/[\w.-]+$/.test(opts.repo) ? `https://github.com/${opts.repo}.git` : opts.repo;

/** A path segment as a directory name: nothing outside `[\w.-]`, and never `.` or `..`. */
const segmentOf = (opts: { segment: string }): string => {
  const cleaned = opts.segment.replace(/[^\w.-]/g, '_');

  return cleaned === '.' || cleaned === '..' ? '_' : cleaned;
};

/**
 * `$XDG_CACHE_HOME/vulcan/atlas/v1/<host>/<path>/` (default `~/.cache`): every segment of the
 * repository's path, so two repositories never share one - GitHub's reads `<host>/<owner>/<repo>`.
 * `git/` holds one partial clone, `<sha>/` a sparse checkout of that commit, `<sha>.atlas/` what the
 * pull built for it.
 */
export const cacheRootOf = (opts: { repo: string }): string => {
  const url = urlOf(opts);
  const withScheme = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?([^/]*)(.*)$/i.exec(url);
  const scpLike = withScheme === null ? /^(?:[^@/]+@)?([^/:]+):(.*)$/.exec(url) : null;
  const isFile = url.startsWith('file://');
  const host = isFile ? 'file' : (withScheme?.[1] ?? scpLike?.[1] ?? '') || 'local';
  const path = isFile ? url.slice('file://'.length) : (withScheme?.[2] ?? scpLike?.[2] ?? url);
  const segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter(segment => segment.length > 0)
    .map(segment => segmentOf({ segment }));
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');

  return join(base, 'vulcan', 'atlas', CACHE_LAYOUT, segmentOf({ segment: host }), ...segments);
};

export const checkoutOf = (opts: { cacheRoot: string; sha: string }): string =>
  join(opts.cacheRoot, opts.sha);

export const artifactsOf = (opts: { cacheRoot: string; sha: string }): string =>
  join(opts.cacheRoot, `${opts.sha}.atlas`);
