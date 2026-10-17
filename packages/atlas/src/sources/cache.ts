import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** The cache layout this atlas reads and writes (V2): a layout from another version is never read. */
const CACHE_LAYOUT = 'v1';

/** `owner/repo` is GitHub's; anything with a scheme (or a path) is a git URL as given. */
export const urlOf = (opts: { repo: string }): string =>
  /^[\w.-]+\/[\w.-]+$/.test(opts.repo) ? `https://github.com/${opts.repo}.git` : opts.repo;

/**
 * `$XDG_CACHE_HOME/vulcan/atlas/v1/<host>/<owner>/<repo>/` (default `~/.cache`): `git/` holds one
 * partial clone, `<sha>/` a sparse checkout of that commit, `<sha>.atlas/` what the pull built for it.
 */
export const cacheRootOf = (opts: { repo: string }): string => {
  const url = urlOf(opts);
  const parsed = /^(?:[a-z]+:\/\/)?(?:[^@/]+@)?([^/:]*)[/:](.*)$/.exec(url);
  const host = url.startsWith('file://') ? 'file' : (parsed?.[1] ?? 'local') || 'local';
  const path = (
    url.startsWith('file://') ? url.slice('file://'.length) : (parsed?.[2] ?? url)
  ).replace(/\.git\/?$/, '');
  const repo = basename(path);
  const owner = basename(dirname(path)) || 'local';
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');

  return join(base, 'vulcan', 'atlas', CACHE_LAYOUT, host, owner, repo);
};

export const checkoutOf = (opts: { cacheRoot: string; sha: string }): string =>
  join(opts.cacheRoot, opts.sha);

export const artifactsOf = (opts: { cacheRoot: string; sha: string }): string =>
  join(opts.cacheRoot, `${opts.sha}.atlas`);
