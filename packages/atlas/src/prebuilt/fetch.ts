import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { AtlasConstants, AtlasTimeouts } from '@/common/constants';
import { ChunkStore } from '@/search/store';
import { MissReasons, PrebuiltConstants, pairNamesOf } from './constants';
import { verifyEnvelope } from './envelope';
import type { IIndexPayload } from './envelope';

export interface IPrebuiltHit {
  hit: true;
  index: Uint8Array;
  payload: IIndexPayload;
}

/** The bounds a reader keeps; the defaults are the ones in `PrebuiltConstants` and `AtlasTimeouts`, a test passes smaller. */
export interface IPrebuiltLimits {
  timeoutMs: number;
  envelopeBytes: number;
  gzBytes: number;
  indexBytes: number;
}

const DEFAULT_LIMITS: IPrebuiltLimits = {
  timeoutMs: AtlasTimeouts.PREBUILT_MS,
  envelopeBytes: PrebuiltConstants.MAX_ENVELOPE_BYTES,
  gzBytes: PrebuiltConstants.MAX_GZ_BYTES,
  indexBytes: PrebuiltConstants.MAX_INDEX_BYTES,
};

export interface IPrebuiltMiss {
  hit: false;
  /** One of `MissReasons`. */
  reason: string;
  detail?: string;
}

const GITHUB_API = 'https://api.github.com';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const JSON_ACCEPT = 'application/vnd.github+json';
const BINARY_ACCEPT = 'application/octet-stream';

/** The API host. A test points `VULCAN_GITHUB_API_URL` at a local fake; no source or manifest can. */
const apiBaseOf = (): URL =>
  new URL((process.env.VULCAN_GITHUB_API_URL ?? GITHUB_API).replace(/\/+$/, ''));

const miss = (opts: { reason: string; detail?: string }): IPrebuiltMiss => ({
  hit: false,
  reason: opts.reason,
  ...(opts.detail === undefined ? {} : { detail: opts.detail }),
});

/** The body, or `undefined` when it is longer than `cap`: a stream is cut at the cap, never read whole. */
const readCapped = async (opts: {
  response: Response;
  cap: number;
}): Promise<Uint8Array | undefined> => {
  const announced = Number(opts.response.headers.get('content-length'));

  if (Number.isFinite(announced) && announced > opts.cap) {
    await opts.response.body?.cancel();

    return undefined;
  }

  const reader = opts.response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (reader !== undefined) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.length;

    if (total > opts.cap) {
      await reader.cancel();

      return undefined;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks);
};

type TReply =
  | { kind: 'ok'; body: Uint8Array }
  | { kind: 'status'; status: number }
  | { kind: 'too-large' };

/**
 * One GET, with the token for the API host only. A redirect (a release asset's content lives on a
 * storage host) is followed by hand: the next request carries no `Authorization` unless it is the API
 * host again, and a redirect to a scheme other than https is refused (an http API base, a test's, may
 * redirect to http).
 */
const get = async (opts: {
  url: string;
  accept: string;
  cap: number;
  token?: string;
  apiBase: URL;
  timeoutMs: number;
}): Promise<TReply> => {
  let url = new URL(opts.url);

  for (let hop = 0; hop <= PrebuiltConstants.MAX_REDIRECTS; hop += 1) {
    const toApi = url.host === opts.apiBase.host;
    const response = await fetch(url, {
      headers: {
        accept: opts.accept,
        'user-agent': 'vulcan-atlas',
        'x-github-api-version': '2022-11-28',
        ...(toApi && opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');

      await response.body?.cancel();

      if (location === null) {
        return { kind: 'status', status: response.status };
      }

      const next = new URL(location, url);

      if (next.protocol !== 'https:' && next.protocol !== opts.apiBase.protocol) {
        return { kind: 'status', status: response.status };
      }

      url = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();

      return { kind: 'status', status: response.status };
    }

    const body = await readCapped({ response, cap: opts.cap });

    return body === undefined ? { kind: 'too-large' } : { kind: 'ok', body };
  }

  return { kind: 'status', status: 310 };
};

const textOf = (opts: { bytes: Uint8Array }): string => new TextDecoder().decode(opts.bytes);

interface IAsset {
  name: string;
  url: string;
}

/** The two assets of the commit among the release's, read page by page until both are found. */
const findPair = async (opts: {
  base: string;
  releaseId: number;
  names: { gz: string; envelope: string };
  token?: string;
  apiBase: URL;
  limits: IPrebuiltLimits;
}): Promise<{ gz?: IAsset; envelope?: IAsset } | IPrebuiltMiss> => {
  const found: { gz?: IAsset; envelope?: IAsset } = {};

  for (let page = 1; page <= PrebuiltConstants.MAX_ASSET_PAGES; page += 1) {
    const reply = await get({
      url: `${opts.base}/releases/${opts.releaseId}/assets?per_page=${PrebuiltConstants.ASSETS_PER_PAGE}&page=${page}`,
      accept: JSON_ACCEPT,
      cap: opts.limits.envelopeBytes,
      token: opts.token,
      apiBase: opts.apiBase,
      timeoutMs: opts.limits.timeoutMs,
    });

    if (reply.kind !== 'ok') {
      return miss({
        reason: MissReasons.UNREACHABLE,
        detail: 'the asset listing was not readable',
      });
    }

    const assets = JSON.parse(textOf({ bytes: reply.body })) as IAsset[];

    for (const asset of assets) {
      if (asset.name === opts.names.gz) {
        found.gz = asset;
      } else if (asset.name === opts.names.envelope) {
        found.envelope = asset;
      }
    }

    if (
      (found.gz !== undefined && found.envelope !== undefined) ||
      assets.length < PrebuiltConstants.ASSETS_PER_PAGE
    ) {
      break;
    }
  }

  return found;
};

/**
 * The prebuilt index of `sha` from the rolling release `atlas-index` of a GitHub repository, or why
 * there is none. Nothing from the download is decompressed, opened or returned until, in this order:
 * a listed key verified the signature; the payload names this commit, this repository and this atlas's
 * format; the gz is within its cap and is the one the payload digests; it decompresses to exactly the
 * size the payload says; and the index opens and holds a `chunks` table. It never throws: every
 * failure is a miss, and the caller builds the index itself.
 */
export const fetchPrebuilt = async (opts: {
  github: { owner: string; repo: string };
  sha: string;
  keys: string[];
  token?: string;
  limits?: Partial<IPrebuiltLimits>;
}): Promise<IPrebuiltHit | IPrebuiltMiss> => {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };

  try {
    const apiBase = apiBaseOf();
    const base = `${apiBase.origin}/repos/${opts.github.owner}/${opts.github.repo}`;
    const names = pairNamesOf({ sha: opts.sha });
    const release = await get({
      url: `${base}/releases/tags/${PrebuiltConstants.RELEASE_TAG}`,
      accept: JSON_ACCEPT,
      cap: limits.envelopeBytes,
      token: opts.token,
      apiBase,
      timeoutMs: limits.timeoutMs,
    });

    if (release.kind === 'status' && release.status === 404) {
      return miss({ reason: MissReasons.NO_RELEASE });
    }

    if (release.kind !== 'ok') {
      return miss({
        reason: MissReasons.UNREACHABLE,
        detail: release.kind === 'status' ? `HTTP ${release.status}` : 'the release was too large',
      });
    }

    const releaseId = (JSON.parse(textOf({ bytes: release.body })) as { id?: unknown }).id;

    if (typeof releaseId !== 'number') {
      return miss({ reason: MissReasons.NO_RELEASE });
    }

    const pair = await findPair({ base, releaseId, names, token: opts.token, apiBase, limits });

    if ('hit' in pair) {
      return pair;
    }

    if (pair.envelope === undefined || pair.gz === undefined) {
      return miss({
        reason: MissReasons.NO_PAIR,
        detail: `${pair.envelope === undefined ? names.envelope : names.gz} is not on the release`,
      });
    }

    if (
      new URL(pair.envelope.url).host !== apiBase.host ||
      new URL(pair.gz.url).host !== apiBase.host
    ) {
      return miss({ reason: MissReasons.FOREIGN_URL });
    }

    const envelopeReply = await get({
      url: pair.envelope.url,
      accept: BINARY_ACCEPT,
      cap: limits.envelopeBytes,
      token: opts.token,
      apiBase,
      timeoutMs: limits.timeoutMs,
    });

    if (envelopeReply.kind !== 'ok') {
      return miss({
        reason:
          envelopeReply.kind === 'too-large' ? MissReasons.TOO_LARGE : MissReasons.UNREACHABLE,
        detail: 'the envelope',
      });
    }

    const verified = verifyEnvelope({
      envelope: textOf({ bytes: envelopeReply.body }),
      keys: opts.keys,
    });

    if (!verified.ok) {
      return miss({ reason: verified.reason });
    }

    const { payload } = verified;

    if (payload.sha !== opts.sha) {
      return miss({ reason: MissReasons.SHA });
    }

    if (payload.repo !== `${opts.github.owner}/${opts.github.repo}`.toLowerCase()) {
      return miss({ reason: MissReasons.REPO });
    }

    if (payload.format !== AtlasConstants.INDEX_FORMAT) {
      return miss({
        reason: MissReasons.FORMAT,
        detail: `${payload.format}, this atlas reads ${AtlasConstants.INDEX_FORMAT}`,
      });
    }

    if (payload.bytes > limits.indexBytes) {
      return miss({ reason: MissReasons.TOO_LARGE, detail: 'the index it announces' });
    }

    const gzReply = await get({
      url: pair.gz.url,
      accept: BINARY_ACCEPT,
      cap: limits.gzBytes,
      token: opts.token,
      apiBase,
      timeoutMs: limits.timeoutMs,
    });

    if (gzReply.kind !== 'ok') {
      return miss({
        reason: gzReply.kind === 'too-large' ? MissReasons.TOO_LARGE : MissReasons.UNREACHABLE,
        detail: 'the index',
      });
    }

    if (createHash('sha256').update(gzReply.body).digest('hex') !== payload.digest) {
      return miss({ reason: MissReasons.DIGEST });
    }

    let index: Uint8Array;

    try {
      index = gunzipSync(gzReply.body, { maxOutputLength: payload.bytes });
    } catch {
      return miss({ reason: MissReasons.SIZE });
    }

    if (index.length !== payload.bytes) {
      return miss({ reason: MissReasons.SIZE });
    }

    try {
      const store = new ChunkStore({ serialized: index });

      store.rowCount();
      store.close();
    } catch {
      return miss({ reason: MissReasons.UNREADABLE });
    }

    return { hit: true, index, payload };
  } catch (error) {
    return miss({
      reason: MissReasons.UNREACHABLE,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
