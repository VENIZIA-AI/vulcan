import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AtlasConstants } from '@/common/constants';
import { MANIFEST_FILE, toAtlasProject } from '@/common/project-config';
import { computeReleases } from '@/releases/compute';
import { git, tagsFingerprintOf } from '@/sources/git';
import { indexBytesOf } from '@/sources/index-build';
import { PrebuiltConstants, pairNamesOf } from './constants';
import { signEnvelope } from './envelope';
import type { IIndexPayload } from './envelope';

export interface IBuiltPair {
  sha: string;
  gz: string;
  envelope: string;
}

const REPOSITORY_NAME = /^[\w.-]+\/[\w.-]+$/;
const GITHUB_REMOTE = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

const commitOf = (opts: { root: string }): string => {
  try {
    return git({ cwd: opts.root, args: ['rev-parse', '--verify', 'HEAD^{commit}'] }).trim();
  } catch {
    throw new Error(`atlas index: ${opts.root} has no commit to index`);
  }
};

/** `--repo`, else `GITHUB_REPOSITORY` (set in Actions), else the GitHub `origin`; always lowercase. */
const repositoryOf = (opts: { root: string; repo?: string }): string => {
  const origin = (): string | undefined => {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: opts.root,
      encoding: 'utf8',
    });

    return result.status === 0 ? GITHUB_REMOTE.exec(result.stdout.trim())?.[1] : undefined;
  };
  const named = opts.repo ?? process.env.GITHUB_REPOSITORY ?? origin();

  if (named === undefined || !REPOSITORY_NAME.test(named)) {
    throw new Error('atlas index: cannot tell the repository - pass --repo <owner/name>');
  }

  return named.toLowerCase();
};

/** The tags fingerprint a reader computes from `git ls-remote`, from this repository's own tags. */
const localTagsFingerprint = (opts: { root: string }): string => {
  const listed = git({
    cwd: opts.root,
    args: ['for-each-ref', 'refs/tags', '--format=%(refname)%09%(objectname)%09%(*objectname)'],
  });
  const refs = new Map<string, string>();

  for (const line of listed.split('\n').filter((entry) => entry.length > 0)) {
    const [name, object, peeled] = line.split('\t');

    refs.set(name, object);

    if (peeled !== undefined && peeled.length > 0) {
      refs.set(`${name}^{}`, peeled);
    }
  }

  return tagsFingerprintOf({ refs });
};

const isInside = (opts: { path: string; directory: string }): boolean => {
  const from = relative(opts.directory, opts.path);

  return from !== '' && !from.startsWith('..') && !isAbsolute(from);
};

/**
 * The pair for HEAD: the index of the commit's tracked files, gzipped, and an envelope that signs it.
 * The index is built in a scratch worktree of the commit - never the working tree - so an untracked,
 * an ignored or an edited file cannot reach a published index, and the build is the one a pull makes.
 */
export const buildIndexPair = (opts: {
  root: string;
  out: string;
  repo?: string;
  privateKey: string | undefined;
  atlasVersion: string;
}): IBuiltPair => {
  const root = resolve(opts.root);
  const out = resolve(root, opts.out);

  if (opts.privateKey === undefined || opts.privateKey.trim().length === 0) {
    throw new Error(
      `atlas index: no signing key - set ${PrebuiltConstants.KEY_ENV} to the private key \`atlas index keygen\` wrote`,
    );
  }

  if (!isInside({ path: out, directory: root })) {
    throw new Error('atlas index: --out must be a folder inside the project');
  }

  const sha = commitOf({ root });
  const repo = repositoryOf({ root, repo: opts.repo });
  const scratch = join(
    root,
    PrebuiltConstants.SCRATCH_DIRECTORY,
    `atlas-index-${sha.slice(0, 8)}-${process.pid}`,
  );

  mkdirSync(join(root, PrebuiltConstants.SCRATCH_DIRECTORY), { recursive: true });
  git({ cwd: root, args: ['worktree', 'add', '--detach', scratch, sha] });

  try {
    const manifestFile = join(scratch, MANIFEST_FILE);

    if (!existsSync(manifestFile)) {
      throw new Error(
        `atlas index: ${sha.slice(0, 8)} has no ${MANIFEST_FILE} - run \`vulcan sync\` and commit it`,
      );
    }

    const project = toAtlasProject({
      root: scratch,
      manifest: JSON.parse(readFileSync(manifestFile, 'utf8')),
      source: 'this repository',
    });
    const index = Buffer.from(indexBytesOf({ project }));
    const gz = gzipSync(index, { level: 9 });
    const payload: IIndexPayload = {
      format: AtlasConstants.INDEX_FORMAT,
      sha,
      repo,
      atlas: opts.atlasVersion,
      builtAt: new Date().toISOString(),
      bytes: index.length,
      digest: createHash('sha256').update(gz).digest('hex'),
      tags: localTagsFingerprint({ root }),
      history: true,
      releases: computeReleases({ project }),
    };
    const names = pairNamesOf({ sha });

    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, names.gz), gz);
    writeFileSync(
      join(out, names.envelope),
      signEnvelope({ payload, privateKey: opts.privateKey }),
    );

    return { sha, gz: join(out, names.gz), envelope: join(out, names.envelope) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], { cwd: root });
  }
};
