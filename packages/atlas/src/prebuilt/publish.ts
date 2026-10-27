import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasTimeouts } from '@/common/constants';
import { buildIndexPair } from './build';
import { PrebuiltConstants, PublishConstants, pairNamesOf } from './constants';
import { itemsOf, numberOf, recordOf, stringOf } from './wire';

type TEnv = Record<string, string | undefined>;

export interface IAssetInfo {
  id: number;
  name: string;
  createdAt: string;
}

export type TGuard = { publish: true } | { publish: false; reason: string };

const PAIR_NAME = /^([0-9a-f]{40})\.atlas\.(gz|json)$/;

/** Whether `sha` is on `origin/<branch>`, from the refs a full checkout has. */
const isOnBranch = (opts: { root: string; sha: string; branch: string }): boolean =>
  spawnSync(
    'git',
    ['merge-base', '--is-ancestor', opts.sha, `refs/remotes/origin/${opts.branch}`],
    {
      cwd: opts.root,
    },
  ).status === 0;

/** The default branch the event names; `undefined` when the event file cannot be read. */
const defaultBranchOf = (opts: { env: TEnv }): string | undefined => {
  try {
    const event = recordOf({
      value: JSON.parse(readFileSync(opts.env.GITHUB_EVENT_PATH ?? '', 'utf8')),
    });

    return stringOf({ value: recordOf({ value: event['repository'] })['default_branch'] });
  } catch {
    return undefined;
  }
};

/**
 * Whether this run may publish. Only a `push`, only to the default branch, to `develop`, or of a tag
 * whose commit is on one of them; never a pull request, never the `atlas-index` tag the release itself
 * makes, never without the key and Actions' own token. Every refusal says why.
 */
export const publishGuard = (opts: {
  root: string;
  env: TEnv;
  keyEnv: string;
  onBranch?: (opts: { sha: string; branch: string }) => boolean;
}): TGuard => {
  const { env } = opts;
  const no = (reason: string): TGuard => ({ publish: false, reason });

  if (env.GITHUB_EVENT_NAME !== 'push') {
    return no(`the event is ${env.GITHUB_EVENT_NAME ?? 'not Actions'}, only a push publishes`);
  }

  if ((env[opts.keyEnv] ?? '').trim().length === 0) {
    return no(`${opts.keyEnv} is empty`);
  }

  if (env.GITHUB_REPOSITORY === undefined || (env.GITHUB_TOKEN ?? '').length === 0) {
    return no('GITHUB_REPOSITORY or GITHUB_TOKEN is missing');
  }

  const defaultBranch = defaultBranchOf({ env });
  const branches = [...new Set([defaultBranch, PublishConstants.DEVELOP_BRANCH])].filter(
    (branch): branch is string => branch !== undefined,
  );
  const ref = env.GITHUB_REF ?? '';

  if (ref.startsWith('refs/heads/')) {
    return branches.includes(ref.slice('refs/heads/'.length))
      ? { publish: true }
      : no(`${ref} is not the default branch or ${PublishConstants.DEVELOP_BRANCH}`);
  }

  if (ref.startsWith('refs/tags/')) {
    if (ref === `refs/tags/${PrebuiltConstants.RELEASE_TAG}`) {
      return no(`${ref} is the tag of the release that holds the pairs`);
    }

    const sha = env.GITHUB_SHA ?? '';
    const onBranch = opts.onBranch ?? ((found) => isOnBranch({ root: opts.root, ...found }));

    return branches.some((branch) => onBranch({ sha, branch }))
      ? { publish: true }
      : no(`${ref} is not on the default branch or ${PublishConstants.DEVELOP_BRANCH}`);
  }

  return no(`${ref || 'no ref'} is not a branch or a tag`);
};

interface IPair {
  sha: string;
  assets: IAssetInfo[];
  complete: boolean;
  at: number;
}

const pairsOf = (opts: { assets: IAssetInfo[] }): IPair[] => {
  const bySha = new Map<string, IAssetInfo[]>();

  for (const asset of opts.assets) {
    const sha = PAIR_NAME.exec(asset.name)?.[1];

    if (sha !== undefined) {
      bySha.set(sha, [...(bySha.get(sha) ?? []), asset]);
    }
  }

  return [...bySha].map(([sha, assets]) => ({
    sha,
    assets,
    complete: new Set(assets.map((asset) => asset.name)).size === 2,
    at: Math.max(...assets.map((asset) => Date.parse(asset.createdAt))),
  }));
};

/**
 * What to delete from the release: the pairs of branch heads beyond the newest `keepHeads`, the oldest
 * release-tag pairs past `maxPairs` in all, and a pair with a member missing once it is older than
 * `orphanAgeMs`. A release-tag commit's pair is a head's too only until it is a tag's: the tag wins. The
 * pair being published (`protect`) and every asset that is not a pair are never touched.
 */
export const decidePrune = (opts: {
  assets: IAssetInfo[];
  tagShas: Set<string>;
  protect: string;
  now: number;
  keepHeads?: number;
  maxPairs?: number;
  orphanAgeMs?: number;
}): { remove: IAssetInfo[]; kept: number } => {
  const keepHeads = opts.keepHeads ?? PublishConstants.KEEP_HEADS;
  const maxPairs = opts.maxPairs ?? PublishConstants.MAX_PAIRS;
  const orphanAgeMs = opts.orphanAgeMs ?? PublishConstants.ORPHAN_AGE_MS;
  const pairs = pairsOf({ assets: opts.assets });
  const remove: IAssetInfo[] = [];
  const newestFirst = (left: IPair, right: IPair): number => right.at - left.at;

  const orphans = pairs.filter((pair) => !pair.complete);
  const whole = pairs.filter((pair) => pair.complete);

  for (const pair of orphans) {
    if (pair.sha !== opts.protect && opts.now - pair.at > orphanAgeMs) {
      remove.push(...pair.assets);
    }
  }

  const heads = whole.filter((pair) => !opts.tagShas.has(pair.sha)).sort(newestFirst);
  const tags = whole.filter((pair) => opts.tagShas.has(pair.sha)).sort(newestFirst);

  /** The pairs of `group` past its `limit`, oldest first to go; the pair being published takes a place of the limit and stays. */
  const beyond = (group: IPair[], limit: number): IPair[] => {
    const others = group.filter((pair) => pair.sha !== opts.protect);
    const places = Math.max(limit - (group.length - others.length), 0);

    return others.slice(places);
  };

  for (const pair of beyond(heads, keepHeads)) {
    remove.push(...pair.assets);
  }

  const keptHeads = heads.filter((pair) => !remove.some((asset) => pair.assets.includes(asset)));

  for (const pair of beyond(tags, Math.max(maxPairs - keptHeads.length, 0))) {
    remove.push(...pair.assets);
  }

  const removedShas = new Set(remove.flatMap((asset) => PAIR_NAME.exec(asset.name)?.[1] ?? []));

  return { remove, kept: whole.filter((pair) => !removedShas.has(pair.sha)).length };
};

/** The peeled commit of every tag but the release's own: the commits whose pairs are kept for good. */
const tagCommitsOf = (opts: { root: string }): Set<string> => {
  const listed = spawnSync(
    'git',
    ['for-each-ref', 'refs/tags', '--format=%(refname:short)%09%(objectname)%09%(*objectname)'],
    { cwd: opts.root, encoding: 'utf8' },
  ).stdout;

  return new Set(
    listed
      .split('\n')
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [name, object, peeled] = line.split('\t');

        return name === PrebuiltConstants.RELEASE_TAG
          ? []
          : [peeled !== undefined && peeled.length > 0 ? peeled : object];
      }),
  );
};

interface IReply {
  status: number;
  json?: unknown;
}

const safeJson = (opts: { text: string }): unknown => {
  try {
    return JSON.parse(opts.text);
  } catch {
    return undefined;
  }
};

const expectOk = (opts: { reply: IReply; what: string }): void => {
  if (opts.reply.status < 200 || opts.reply.status >= 300) {
    throw new Error(`atlas index publish: ${opts.what} answered HTTP ${opts.reply.status}`);
  }
};

type TCall = (request: {
  method: string;
  url: string;
  body?: string | Uint8Array;
  contentType?: string;
}) => Promise<IReply>;

/** The id and upload URL of a release as GitHub describes it; `undefined` when either is missing. */
const releaseOf = (opts: { json: unknown }): { id: number; uploadUrl: string } | undefined => {
  const record = recordOf({ value: opts.json });
  const id = numberOf({ value: record['id'] });
  const uploadUrl = stringOf({ value: record['upload_url'] });

  return id === undefined || uploadUrl === undefined ? undefined : { id, uploadUrl };
};

/** The release `atlas-index`, made once if it is not there; a lost race for it reads the winner's. */
const ensureRelease = async (opts: {
  call: TCall;
  base: string;
  sha: string;
}): Promise<{ id: number; uploadUrl: string }> => {
  const read = async (): Promise<{ id: number; uploadUrl: string } | undefined> => {
    const reply = await opts.call({
      method: 'GET',
      url: `${opts.base}/releases/tags/${PrebuiltConstants.RELEASE_TAG}`,
    });

    return reply.status === 200 ? releaseOf({ json: reply.json }) : undefined;
  };

  const found = await read();

  if (found !== undefined) {
    return found;
  }

  const created = await opts.call({
    method: 'POST',
    url: `${opts.base}/releases`,
    contentType: 'application/json',
    body: JSON.stringify(
      Object.fromEntries([
        ['tag_name', PrebuiltConstants.RELEASE_TAG],
        ['target_commitish', opts.sha],
        ['name', PublishConstants.RELEASE_NAME],
        ['body', PublishConstants.RELEASE_NOTES],
        ['prerelease', true],
        ['make_latest', 'false'],
      ]),
    ),
  });
  const made = created.status === 201 ? releaseOf({ json: created.json }) : undefined;

  if (made !== undefined) {
    return made;
  }

  const raced = created.status === 422 ? await read() : undefined;

  if (raced === undefined) {
    throw new Error(
      `atlas index publish: the release ${PrebuiltConstants.RELEASE_TAG} could not be made (HTTP ${created.status})`,
    );
  }

  return raced;
};

const listAssets = async (opts: {
  call: TCall;
  base: string;
  releaseId: number;
}): Promise<IAssetInfo[]> => {
  const found: IAssetInfo[] = [];

  for (let page = 1; page <= PrebuiltConstants.MAX_ASSET_PAGES; page += 1) {
    const reply = await opts.call({
      method: 'GET',
      url: `${opts.base}/releases/${opts.releaseId}/assets?per_page=${PrebuiltConstants.ASSETS_PER_PAGE}&page=${page}`,
    });

    expectOk({ reply, what: 'list the assets' });

    const items = itemsOf({ value: reply.json });

    found.push(
      ...items.flatMap((item): IAssetInfo[] => {
        const record = recordOf({ value: item });
        const id = numberOf({ value: record['id'] });
        const name = stringOf({ value: record['name'] });
        const createdAt = stringOf({ value: record['created_at'] });

        return id === undefined || name === undefined || createdAt === undefined
          ? []
          : [{ id, name, createdAt }];
      }),
    );

    if (items.length < PrebuiltConstants.ASSETS_PER_PAGE) {
      break;
    }
  }

  return found;
};

export interface IPublished {
  published: true;
  sha: string;
  uploaded: string[];
  deleted: string[];
  kept: number;
}

/**
 * Publishes the pair of HEAD to the release `atlas-index` of `GITHUB_REPOSITORY`: the guard first; then the
 * pair is built and signed; the release is made once (a pre-release that is not latest, its tag never
 * moved); an older pair of the same commit is removed before the new one goes up; the release is pruned.
 * Every URL is built from `GITHUB_REPOSITORY`: there is no input that names another repository, and the
 * token goes to the API host, and to the upload host the API names only when it is the API host's own.
 */
export const publishIndex = async (opts: {
  root: string;
  env: TEnv;
  keyEnv: string;
  atlasVersion: string;
  now?: () => number;
  onBranch?: (opts: { sha: string; branch: string }) => boolean;
}): Promise<IPublished | { published: false; reason: string }> => {
  const guard = publishGuard(opts);

  if (!guard.publish) {
    return { published: false, reason: guard.reason };
  }

  const repo = (opts.env.GITHUB_REPOSITORY ?? '').toLowerCase();
  const token = opts.env.GITHUB_TOKEN ?? '';
  const api = new URL((opts.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''));
  const uploadHost = api.host === 'api.github.com' ? 'uploads.github.com' : api.host;
  const base = `${api.origin}/repos/${opts.env.GITHUB_REPOSITORY}`;

  const call = async (request: {
    method: string;
    url: string;
    body?: string | Uint8Array;
    contentType?: string;
  }): Promise<IReply> => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'vulcan-atlas',
        'x-github-api-version': '2022-11-28',
        ...(request.contentType === undefined ? {} : { 'content-type': request.contentType }),
      },
      body: request.body,
      redirect: 'error',
      signal: AbortSignal.timeout(AtlasTimeouts.DOWNLOAD_MS),
    });
    const text = await response.text();

    return { status: response.status, json: text.length > 0 ? safeJson({ text }) : undefined };
  };

  const out = join(opts.root, PublishConstants.SCRATCH_OUT);

  rmSync(out, { recursive: true, force: true });

  try {
    const built = buildIndexPair({
      root: opts.root,
      out,
      repo,
      privateKey: opts.env[opts.keyEnv],
      atlasVersion: opts.atlasVersion,
      requireFullHistory: true,
    });
    const release = await ensureRelease({ call, base, sha: opts.env.GITHUB_SHA ?? built.sha });
    const names = pairNamesOf({ sha: built.sha });
    const listed = await listAssets({ call, base, releaseId: release.id });
    const deleted: string[] = [];

    for (const asset of listed.filter(
      (entry) => entry.name === names.gz || entry.name === names.envelope,
    )) {
      expectOk({
        reply: await call({ method: 'DELETE', url: `${base}/releases/assets/${asset.id}` }),
        what: `delete ${asset.name}`,
      });
      deleted.push(asset.name);
    }

    const uploadBase = new URL(release.uploadUrl.replace(/\{.*$/, ''));

    if (
      uploadBase.host !== uploadHost ||
      !uploadBase.pathname.startsWith(`/repos/${opts.env.GITHUB_REPOSITORY}/releases/`)
    ) {
      throw new Error(
        `atlas index publish: the release names an upload URL outside ${opts.env.GITHUB_REPOSITORY}`,
      );
    }

    const uploaded: string[] = [];

    const files: [string, string][] = [
      [names.gz, built.gz],
      [names.envelope, built.envelope],
    ];

    for (const [name, file] of files) {
      expectOk({
        reply: await call({
          method: 'POST',
          url: `${uploadBase.origin}${uploadBase.pathname}?name=${encodeURIComponent(name)}`,
          body: readFileSync(file),
          contentType: 'application/octet-stream',
        }),
        what: `upload ${name}`,
      });
      uploaded.push(name);
    }

    const decision = decidePrune({
      assets: await listAssets({ call, base, releaseId: release.id }),
      tagShas: tagCommitsOf({ root: opts.root }),
      protect: built.sha,
      now: (opts.now ?? Date.now)(),
    });

    for (const asset of decision.remove) {
      expectOk({
        reply: await call({ method: 'DELETE', url: `${base}/releases/assets/${asset.id}` }),
        what: `prune ${asset.name}`,
      });
      deleted.push(asset.name);
    }

    return { published: true, sha: built.sha, uploaded, deleted, kept: decision.kept };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
};
