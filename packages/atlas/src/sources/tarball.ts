import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GITHUB = 'https://github.com';
const CODELOAD = 'https://codeload.github.com';
const ADVERTISED_REF = /([0-9a-f]{40}) (refs\/[^\0\n]+)/g;

/** Whether git runs on this machine; without it, a GitHub source comes by tarball. */
export const hasGit = (): boolean => spawnSync('git', ['--version']).status === 0;

/** `owner/repo` - the only form with a tarball path. */
export const githubRepoOf = (opts: {
  repo: string;
}): { owner: string; repo: string } | undefined => {
  const parts = /^([\w.-]+)\/([\w.-]+)$/.exec(opts.repo);

  return parts === null ? undefined : { owner: parts[1], repo: parts[2] };
};

/**
 * The commit `ref` names, from the repository's smart-HTTP ref advertisement - what `git ls-remote`
 * reads, over plain HTTP. Never the GitHub REST API (60 requests an hour, unauthenticated).
 */
export const lsRemoteByHttp = async (opts: {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
}): Promise<string | undefined> => {
  const base = (process.env.VULCAN_GITHUB_URL ?? GITHUB).replace(/\/+$/, '');
  const response = await fetch(
    `${base}/${opts.owner}/${opts.repo}.git/info/refs?service=git-upload-pack`,
    {
      headers:
        opts.token === undefined
          ? {}
          : {
              authorization: `Basic ${Buffer.from(`x-access-token:${opts.token}`).toString('base64')}`,
            },
    },
  ).catch(() => undefined);

  if (response === undefined || !response.ok) {
    return undefined;
  }

  const refs = new Map(
    [...(await response.text()).matchAll(ADVERTISED_REF)].map(match => [match[2], match[1]]),
  );

  return (
    refs.get(`refs/heads/${opts.ref}`) ??
    refs.get(`refs/tags/${opts.ref}^{}`) ??
    refs.get(`refs/tags/${opts.ref}`)
  );
};

/**
 * The tarball of one commit, unpacked into `directory` - only the given paths (the manifest's
 * directory first; then, called again, the paths it declares), the archive's top directory stripped.
 */
export const extractTarball = async (opts: {
  owner: string;
  repo: string;
  sha: string;
  token?: string;
  directory: string;
  paths: string[];
}): Promise<void> => {
  const base = (process.env.VULCAN_CODELOAD_URL ?? CODELOAD).replace(/\/+$/, '');
  const response = await fetch(`${base}/${opts.owner}/${opts.repo}/tar.gz/${opts.sha}`, {
    headers: opts.token === undefined ? {} : { authorization: `token ${opts.token}` },
  });

  if (!response.ok) {
    throw new Error(
      `atlas: no tarball of ${opts.owner}/${opts.repo} at ${opts.sha.slice(0, 8)} (${response.status})`,
    );
  }

  const work = mkdtempSync(join(tmpdir(), 'atlas-source-tarball-'));

  try {
    const archive = join(work, 'source.tgz');

    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
    mkdirSync(opts.directory, { recursive: true });

    const unpacked = spawnSync(
      'tar',
      [
        '-xzf',
        archive,
        '-C',
        opts.directory,
        '--strip-components=1',
        '--wildcards',
        ...opts.paths.map(path => `*/${path}/*`),
      ],
      { encoding: 'utf8' },
    );

    if (unpacked.status !== 0) {
      throw new Error(`atlas: could not unpack ${opts.owner}/${opts.repo}: ${unpacked.stderr}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};
