import { StderrLogger } from '@/common/logger';
import { githubTokenOf } from '@/sources/credentials';
import { githubRepoOf } from '@/sources/tarball';
import type { IAtlasSource } from '@/sources/common';
import { fetchPrebuilt } from './fetch';
import type { IPrebuiltHit } from './fetch';

/**
 * A prebuilt index for a source's commit, or `undefined` and the caller builds it. Nothing is asked
 * of the network (and no token is looked up) unless the download is on, the source is a GitHub
 * `owner/repo` and its manifest lists keys. A miss says why, once, on stderr.
 */
export const attemptPrebuilt = async (opts: {
  enabled: boolean;
  source: IAtlasSource;
  sha: string;
  keys: string[];
}): Promise<IPrebuiltHit | undefined> => {
  const github = githubRepoOf(opts.source);

  if (!opts.enabled || opts.keys.length === 0 || github === undefined) {
    return undefined;
  }

  const result = await fetchPrebuilt({
    github,
    sha: opts.sha,
    keys: opts.keys,
    token: githubTokenOf(),
  });

  if (result.hit) {
    return result;
  }

  StderrLogger.get('prebuilt').warn(
    `the prebuilt index is not used, building it here | source: ${opts.source.name} | commit: ${opts.sha.slice(0, 8)} | reason: ${result.reason}${result.detail === undefined ? '' : ` (${result.detail})`}`,
  );

  return undefined;
};
