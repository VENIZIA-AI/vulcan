import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { resolveSources } from '@/sources';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
  writeSourceFile,
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

const consumer = (): string => makeTempDirectory({ prefix: 'atlas-consumer-' });

const failureOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'resolved',
    (error: unknown) => String(error),
  );

/** One more commit on `develop`, pushed; its SHA. */
const pushCommit = (opts: { work: string; name: string }): string => {
  writeSourceFile({
    work: opts.work,
    path: `docs/changelogs/2026-02-01-${opts.name}.md`,
    text: `---\ntitle: ${opts.name}\npackages: ['@x/kernel']\n---\n\nA change.\n`,
  });
  commitAll({ work: opts.work, message: `docs: ${opts.name}` });
  git({ cwd: opts.work, args: ['push', '-q', 'origin', 'develop'] });

  return git({ cwd: opts.work, args: ['rev-parse', 'HEAD'] });
};

describe('a source ref', () => {
  test('a commit SHA - full or short - is used as it is, and fetched', async () => {
    const source = makeSourceRepository();
    const first = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });

    pushCommit({ work: source.work, name: 'second' });

    const cwd = consumer();
    const [byFull] = await resolveSources({
      cwd,
      cacheDir,
      sources: [{ name: 'src', repo: source.url, ref: first }],
    });

    expect(byFull.sha).toBe(first);
    expect(byFull.mode).toBe('fresh');

    const [byShort] = await resolveSources({
      cwd,
      cacheDir,
      sources: [{ name: 'src', repo: source.url, ref: first.slice(0, 7) }],
    });

    expect(byShort.sha).toBe(first);
    expect(byShort.mode).toBe('cache');
  });

  test('a short SHA on a cold cache is expanded once the clone is fetched', async () => {
    const source = makeSourceRepository();
    const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });
    const [resolved] = await resolveSources({
      cwd: consumer(),
      cacheDir,
      sources: [{ name: 'src', repo: source.url, ref: sha.slice(0, 10) }],
    });

    expect(resolved.sha).toBe(sha);
    expect(resolved.mode).toBe('fresh');
  });

  test('a ref the remote does not have is an error naming it - never the cache', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();

    await resolveSources({
      cwd,
      cacheDir,
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    const failure = await failureOf(
      resolveSources({
        cwd,
        cacheDir,
        sources: [{ name: 'src', repo: source.url, ref: 'no-such-branch' }],
      }),
    );

    expect(failure).toContain("no branch or tag 'no-such-branch'");
  });

  test('a ref matches a whole name: `release` never resolves to `feature/release`', async () => {
    const source = makeSourceRepository();

    git({ cwd: source.work, args: ['switch', '-q', '-c', 'feature/release'] });
    pushCommit({ work: source.work, name: 'feature' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'feature/release'] });

    const failure = await failureOf(
      resolveSources({
        cwd: consumer(),
        cacheDir,
        sources: [{ name: 'src', repo: source.url, ref: 'release' }],
      }),
    );

    expect(failure).toContain("no branch or tag 'release'");
  });
});
