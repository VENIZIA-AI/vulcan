import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasTimeouts } from '@/common/constants';
import { StderrLogger } from '@/common/logger';
import type { IRemoteRef } from './common';
import { pickRef, tagsFingerprintOf } from './git';

const GITHUB = 'https://github.com';
const CODELOAD = 'https://codeload.github.com';
const ADVERTISED_REF = /([0-9a-f]{40}) (refs\/[^\0\n]+)/g;
const LISTING_BUFFER = 256 * 1024 * 1024;

/** Whether git runs on this machine; without it, a GitHub source comes by tarball. */
export const hasGit = (): boolean => spawnSync('git', ['--version']).status === 0;

/** `owner/repo` - the only form with a tarball path. */
export const githubRepoOf = (opts: {
  repo: string;
}): { owner: string; repo: string } | undefined => {
  const parts = /^([\w.-]+)\/([\w.-]+)$/.exec(opts.repo);

  return parts === null ? undefined : { owner: parts[1], repo: parts[2] };
};

/** A response's body, or `undefined` when the request failed or outlived `timeout`. */
const fetchBody = async (opts: {
  url: string;
  headers: Record<string, string>;
  timeout: number;
}): Promise<{ status: number; body?: ArrayBuffer }> => {
  try {
    const response = await fetch(opts.url, {
      headers: opts.headers,
      signal: AbortSignal.timeout(opts.timeout),
    });

    return response.ok
      ? { status: response.status, body: await response.arrayBuffer() }
      : { status: response.status };
  } catch (error) {
    StderrLogger.get('fetchBody').warn('the request failed | error: %s', error);

    return { status: 0 };
  }
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
}): Promise<IRemoteRef> => {
  const base = (process.env.VULCAN_GITHUB_URL ?? GITHUB).replace(/\/+$/, '');
  const { body } = await fetchBody({
    url: `${base}/${opts.owner}/${opts.repo}.git/info/refs?service=git-upload-pack`,
    headers:
      opts.token === undefined
        ? {}
        : {
            authorization: `Basic ${Buffer.from(`x-access-token:${opts.token}`).toString('base64')}`,
          },
    timeout: AtlasTimeouts.REF_LOOKUP_MS,
  });

  if (body === undefined) {
    return { reachable: false };
  }

  const refs = new Map(
    [...Buffer.from(body).toString('utf8').matchAll(ADVERTISED_REF)].map((match) => [
      match[2],
      match[1],
    ]),
  );

  return {
    reachable: true,
    sha: pickRef({ refs, ref: opts.ref }),
    tags: tagsFingerprintOf({ refs }),
  };
};

/** The tarball of one commit, downloaded once into `work`: every extraction reads the same archive. */
export const downloadTarball = async (opts: {
  owner: string;
  repo: string;
  sha: string;
  token?: string;
  work: string;
}): Promise<string> => {
  const base = (process.env.VULCAN_CODELOAD_URL ?? CODELOAD).replace(/\/+$/, '');
  const { status, body } = await fetchBody({
    url: `${base}/${opts.owner}/${opts.repo}/tar.gz/${opts.sha}`,
    headers: opts.token === undefined ? {} : { authorization: `token ${opts.token}` },
    timeout: AtlasTimeouts.DOWNLOAD_MS,
  });

  if (body === undefined) {
    throw new Error(
      `atlas: no tarball of ${opts.owner}/${opts.repo} at ${opts.sha.slice(0, 8)} (${status})`,
    );
  }

  const archive = join(opts.work, 'source.tgz');

  writeFileSync(archive, new Uint8Array(body));

  return archive;
};

/**
 * The given paths of the archive, unpacked into `directory` with its top directory stripped. A path
 * the archive holds nothing under is skipped: a manifest declares a directory before anything is
 * written there, and tar would fail on it.
 */
export const extractTarball = (opts: {
  archive: string;
  directory: string;
  paths: string[];
}): void => {
  const listed = spawnSync('tar', ['-tzf', opts.archive], {
    encoding: 'utf8',
    maxBuffer: LISTING_BUFFER,
  });

  if (listed.status !== 0) {
    throw new Error(`atlas: could not read the tarball: ${listed.stderr}`);
  }

  const members = listed.stdout.split('\n').map((member) => member.slice(member.indexOf('/') + 1));
  const present = opts.paths.filter((path) =>
    members.some((member) => member.startsWith(`${path}/`)),
  );

  mkdirSync(opts.directory, { recursive: true });

  if (present.length === 0) {
    return;
  }

  const unpacked = spawnSync(
    'tar',
    [
      '-xzf',
      opts.archive,
      '-C',
      opts.directory,
      '--strip-components=1',
      '--wildcards',
      ...present.map((path) => `*/${path}/*`),
    ],
    { encoding: 'utf8' },
  );

  if (unpacked.status !== 0) {
    throw new Error(`atlas: could not unpack the tarball: ${unpacked.stderr}`);
  }
};
