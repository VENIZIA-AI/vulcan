import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { cacheRootOf, resolveSources } from '@/sources';
import {
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let cacheDir: string;

beforeEach(() => {
  cacheDir = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  delete process.env.VULCAN_NPM_REGISTRY;
});

/** The ref lookup's bound (10 s), and room for the cached start after it. */
const REF_LOOKUP_BOUND_MS = 15_000;

/** A host that accepts a connection and never answers - the hang no remote call may wait out. */
const listenSilently = () =>
  Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => undefined } });

test(
  'a remote that never answers falls back to the newest cache within the ref lookup bound',
  async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const [cached] = await resolveSources({
      cwd,
      cacheDir,
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });
    const silent = listenSilently();
    const repo = `http://127.0.0.1:${silent.port}/acme/source.git`;

    // The same cache, under the silent host's name: the remote is all that changed.
    mkdirSync(dirname(cacheRootOf({ repo, cacheBase: cacheDir })), { recursive: true });
    renameSync(
      cacheRootOf({ repo: source.url, cacheBase: cacheDir }),
      cacheRootOf({ repo, cacheBase: cacheDir }),
    );

    const started = Date.now();

    try {
      const [offline] = await resolveSources({
        cwd,
        cacheDir,
        sources: [{ name: 'src', repo, ref: 'develop' }],
      });

      expect(offline.mode).toBe('offline-cache');
      expect(offline.sha).toBe(cached.sha);
      expect(Date.now() - started).toBeLessThan(REF_LOOKUP_BOUND_MS);
    } finally {
      silent.stop(true);
    }
  },
  { timeout: 40_000 },
);
