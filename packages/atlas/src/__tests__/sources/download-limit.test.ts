import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasLimits, BoundedBody } from '@/common/limits';
import { ProjectConfig } from '@/common/project-config';
import { GithubTarball } from '@/sources/tarball';
import { SymbolCompute } from '@/symbols/compute';
import { makeTempDirectory, TEMP_DIRECTORIES } from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const MIB = 1024 * 1024;
const previous = { ...process.env };

afterEach(() => {
  AtlasLimits.configure({});

  for (const key of ['VULCAN_CODELOAD_URL', 'VULCAN_NPM_REGISTRY']) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
});

/** A response of `bytes` bytes sent in 64 KiB chunks, saying `announced` as its length when given. */
const responseOf = (opts: {
  bytes: number;
  announced?: number;
}): { response: Response; state: { pulled: number; isCancelled: boolean } } => {
  const state = { pulled: 0, isCancelled: false };
  const chunk = new Uint8Array(64 * 1024).fill(7);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      state.pulled += 1;

      if (sent >= opts.bytes) {
        controller.close();

        return;
      }

      const size = Math.min(chunk.byteLength, opts.bytes - sent);

      controller.enqueue(chunk.subarray(0, size));
      sent += size;
    },
    cancel: () => {
      state.isCancelled = true;
    },
  });
  const headers: Record<string, string> =
    opts.announced === undefined ? {} : { 'content-length': String(opts.announced) };

  return { response: new Response(body, { headers }), state };
};

/** A server that answers every request with `bytes` zero bytes, and counts what it was asked. */
const serve = (opts: { bytes: number }) => {
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      paths.push(new URL(request.url).pathname);

      return new Response(new Uint8Array(opts.bytes));
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, paths, stop: () => server.stop(true) };
};

describe('BoundedBody.read', () => {
  test('a body within the cap is returned whole, and so is one of exactly the cap', async () => {
    const small = await BoundedBody.read({ response: responseOf({ bytes: 1000 }).response, cap: 4096 });
    const exact = await BoundedBody.read({
      response: responseOf({ bytes: 200_000 }).response,
      cap: 200_000,
    });

    expect(small?.byteLength).toBe(1000);
    expect(exact?.byteLength).toBe(200_000);
    expect(exact?.every((byte) => byte === 7)).toBe(true);
  });

  test('a body one byte over the cap is refused, and the stream is cancelled', async () => {
    const { response, state } = responseOf({ bytes: 200_001 });

    expect(await BoundedBody.read({ response, cap: 200_000 })).toBeUndefined();
    expect(state.isCancelled).toBe(true);
  });

  test('an announced length over the cap is refused before the body is read', async () => {
    const { response, state } = responseOf({ bytes: 1000, announced: 5000 });

    expect(await BoundedBody.read({ response, cap: 4096 })).toBeUndefined();
    expect(state.pulled).toBe(0);
  });

  test('a response that announces a small length and sends more is cut off at the cap', async () => {
    const { response, state } = responseOf({ bytes: 10 * MIB, announced: 100 });

    expect(await BoundedBody.read({ response, cap: MIB })).toBeUndefined();
    expect(state.isCancelled).toBe(true);
    // 1 MiB is 16 chunks of 64 KiB: it stopped there, not at the end of 10 MiB.
    expect(state.pulled).toBeLessThan(40);
  });

  test('an empty body is empty', async () => {
    expect((await BoundedBody.read({ response: new Response(null), cap: 10 }))?.byteLength).toBe(0);
  });
});

describe('AtlasLimits', () => {
  test('the default is 128 MiB, and a value within 1 MiB to 1 GiB replaces it', () => {
    expect(AtlasLimits.downloadBytes()).toBe(128 * MIB);

    AtlasLimits.configure({ download: 5 * MIB });
    expect(AtlasLimits.downloadBytes()).toBe(5 * MIB);

    AtlasLimits.configure({ download: MIB });
    expect(AtlasLimits.downloadBytes()).toBe(MIB);

    AtlasLimits.configure({ download: 1024 * MIB });
    expect(AtlasLimits.downloadBytes()).toBe(1024 * MIB);
  });

  test('a value outside the bounds, or not an integer, keeps the default', () => {
    for (const download of [0, 1, MIB - 1, 1024 * MIB + 1, -5, 1.5, Number.NaN, Infinity]) {
      AtlasLimits.configure({ download });

      expect(AtlasLimits.downloadBytes(), String(download)).toBe(128 * MIB);
    }

    AtlasLimits.configure({ download: 5 * MIB });
    AtlasLimits.configure({});
    expect(AtlasLimits.downloadBytes()).toBe(128 * MIB);
  });

  test('the manifest value is read when it is usable, and left out otherwise', () => {
    const limitOf = (download: unknown) =>
      ProjectConfig.toAtlasProject({
        root: '.',
        manifest: { schemaVersion: 1, atlas: { limits: { download } } },
      }).downloadLimit;

    expect(limitOf(5 * MIB)).toBe(5 * MIB);
    expect(limitOf(10)).toBeUndefined();
    expect(limitOf('5242880')).toBeUndefined();
    expect(limitOf(undefined)).toBeUndefined();
    expect(
      ProjectConfig.toAtlasProject({ root: '.', manifest: { schemaVersion: 1 } }).downloadLimit,
    ).toBeUndefined();
  });
});

describe('the tarball of a GitHub source', () => {
  const work = (): string => makeTempDirectory({ prefix: 'atlas-download-' });
  const sha = 'a'.repeat(40);

  test('a tarball over atlas.limits.download is refused, naming the limit, and nothing is kept', async () => {
    const server = serve({ bytes: MIB + 1 });
    const directory = work();

    process.env.VULCAN_CODELOAD_URL = server.url;
    AtlasLimits.configure({ download: MIB });

    try {
      const failure = await GithubTarball.download({
        owner: 'acme',
        repo: 'src',
        sha,
        work: directory,
      }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

      expect(failure).toContain('atlas: the tarball of acme/src at aaaaaaaa is over atlas.limits.download');
      expect(failure).toContain(`(${MIB} bytes)`);
      expect(existsSync(join(directory, 'source.tgz'))).toBe(false);
    } finally {
      server.stop();
    }
  });

  test('a tarball of exactly the limit is written', async () => {
    const server = serve({ bytes: MIB });
    const directory = work();

    process.env.VULCAN_CODELOAD_URL = server.url;
    AtlasLimits.configure({ download: MIB });

    try {
      const archive = await GithubTarball.download({
        owner: 'acme',
        repo: 'src',
        sha,
        work: directory,
      });

      expect(existsSync(archive)).toBe(true);
      expect(server.paths).toEqual([`/acme/src/tar.gz/${sha}`]);
    } finally {
      server.stop();
    }
  });

  test('the default admits a tarball that the 1 MiB setting refuses', async () => {
    const server = serve({ bytes: 2 * MIB });

    process.env.VULCAN_CODELOAD_URL = server.url;

    try {
      const archive = await GithubTarball.download({
        owner: 'acme',
        repo: 'src',
        sha,
        work: work(),
      });

      expect(existsSync(archive)).toBe(true);
    } finally {
      server.stop();
    }
  });
});

describe('the npm tarball of a package version', () => {
  test('a tarball over atlas.limits.download is refused, naming the package and the limit', async () => {
    const server = serve({ bytes: MIB + 1 });

    process.env.VULCAN_NPM_REGISTRY = server.url;
    AtlasLimits.configure({ download: MIB });

    try {
      const failure = await SymbolCompute.symbolsOfPublished({
        name: '@x/big',
        version: '1.0.0',
        cacheBase: makeTempDirectory({ prefix: 'atlas-npm-cache-' }),
      }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

      expect(failure).toContain('atlas: the npm tarball of @x/big@1.0.0 is over atlas.limits.download');
      expect(failure).toContain(`(${MIB} bytes)`);
    } finally {
      server.stop();
    }
  });
});
