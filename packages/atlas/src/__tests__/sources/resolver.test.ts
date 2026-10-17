import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { resolveSources } from '@/sources';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previousCache = process.env.XDG_CACHE_HOME;

beforeEach(() => {
  process.env.XDG_CACHE_HOME = makeTempDirectory({ prefix: 'atlas-cache-' });
});

afterEach(() => {
  process.env.XDG_CACHE_HOME = previousCache;
});

const consumer = (): string => makeTempDirectory({ prefix: 'atlas-consumer-' });

describe('resolveSources', () => {
  test('a first start pulls the manifest and its declared paths only, and builds the index', async () => {
    const source = makeSourceRepository();
    const [resolved] = await resolveSources({
      cwd: consumer(),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    expect(resolved.mode).toBe('fresh');
    expect(resolved.sha).toBe(git({ cwd: source.work, args: ['rev-parse', 'HEAD'] }));
    expect(existsSync(join(resolved.root, '.agents/vulcan.manifest.json'))).toBe(true);
    expect(existsSync(join(resolved.root, '.agents/knowledge/overview/kernel.md'))).toBe(true);
    expect(existsSync(join(resolved.root, 'docs/changelogs/2026-01-01-first.md'))).toBe(true);
    expect(existsSync(join(resolved.root, 'packages'))).toBe(false);
    expect(existsSync(resolved.indexFile ?? '')).toBe(true);
    expect(resolved.project.name).toBe('src');
  });

  test('its releases are computed at the pull, so an offline start still has them', async () => {
    const source = makeSourceRepository();
    const [resolved] = await resolveSources({
      cwd: consumer(),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });
    const releases = JSON.parse(readFileSync(resolved.releasesFile ?? '', 'utf8'));

    expect(releases.releases.kernel.map((record: { version: string }) => record.version)).toEqual([
      '1.0.0',
    ]);
    expect(releases.changelogs.map((entry: { id: string }) => entry.id)).toEqual([
      'changelog:2026-01-01-first',
    ]);
  });

  test('the same SHA again is served from the cache, with no clone', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];

    await resolveSources({ cwd, sources });

    // Positive control: the remote keeps its refs but loses every object - ls-remote still names the
    // SHA, and a clone or a fetch cannot run.
    renameSync(join(source.bare, 'objects'), join(source.bare, 'objects.gone'));
    mkdirSync(join(source.bare, 'objects/info'), { recursive: true });
    mkdirSync(join(source.bare, 'objects/pack'), { recursive: true });

    const [again] = await resolveSources({ cwd, sources });

    rmSync(join(source.bare, 'objects'), { recursive: true });
    renameSync(join(source.bare, 'objects.gone'), join(source.bare, 'objects'));
    expect(again.mode).toBe('cache');
  });

  test('a new commit on the ref is pulled on the next start', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const [first] = await resolveSources({ cwd, sources });

    writeSourceFile({
      work: source.work,
      path: 'docs/changelogs/2026-02-01-second.md',
      text: "---\ntitle: Second\npackages: ['@x/kernel']\n---\n\nThe second change.\n",
    });
    commitAll({ work: source.work, message: 'docs: second' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });

    const [second] = await resolveSources({ cwd, sources });

    expect(second.mode).toBe('fresh');
    expect(second.sha).not.toBe(first.sha);
    expect(existsSync(join(second.root, 'docs/changelogs/2026-02-01-second.md'))).toBe(true);
  });

  test('pull forces a fetch even on the same SHA', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];

    await resolveSources({ cwd, sources });

    const [forced] = await resolveSources({ cwd, sources, force: true });

    expect(forced.mode).toBe('fresh');
  });

  test('an unreachable remote serves the newest cache, and says so', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const [first] = await resolveSources({ cwd, sources });

    renameSync(source.bare, `${source.bare}.away`);

    const [offline] = await resolveSources({ cwd, sources });

    renameSync(`${source.bare}.away`, source.bare);
    expect(offline.mode).toBe('offline-cache');
    expect(offline.sha).toBe(first.sha);

    // The server says so to every client, on initialize.
    const initialized = JSON.parse(
      (await buildSourcesServer({ sources: [offline], cwd, version: '0.0.0' }).handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })) ?? 'null',
    );

    expect(initialized.result.instructions).toContain('OFFLINE: the remote was unreachable');
  });

  test('unreachable with no cache stops, naming the source', async () => {
    const failure = await resolveSources({
      cwd: consumer(),
      sources: [{ name: 'gone', repo: 'file:///nowhere/at/all.git', ref: 'develop' }],
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String(failure)).toContain(
      "atlas: source 'gone' (file:///nowhere/at/all.git@develop) is unreachable and has no cache",
    );
  });

  test('a working directory with a manifest is served in repo mode, with no git', async () => {
    const cwd = consumer();

    writeSourceFile({
      work: cwd,
      path: '.agents/vulcan.manifest.json',
      text: '{ "schemaVersion": 1, "name": "self" }\n',
    });

    const resolved = await resolveSources({ cwd, sources: [] });

    expect(
      resolved.map(entry => ({ mode: entry.mode, root: entry.root, name: entry.name })),
    ).toEqual([{ mode: 'repository', root: cwd, name: 'self' }]);
  });
});
