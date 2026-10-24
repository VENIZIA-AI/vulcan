import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { restoreVariable } from '../env.helper';
import { cacheRootOf, resolveSources } from '@/sources';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  SOURCE_MANIFEST,
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
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  restoreVariable({ name: 'XDG_CACHE_HOME', value: previousCache });
  delete process.env.VULCAN_NPM_REGISTRY;
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

  test('a release tag pushed after its commit was pulled is read on the next start, with no new pull', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const [first] = await resolveSources({ cwd, sources });
    const indexed = statSync(first.indexFile ?? '').mtimeMs;

    git({ cwd: source.work, args: ['tag', 'kernel-v1.1.0'] });
    git({ cwd: source.work, args: ['push', '-q', 'origin', '--tags'] });

    const [second] = await resolveSources({ cwd, sources });
    const releases = JSON.parse(readFileSync(second.releasesFile ?? '', 'utf8'));

    expect(second.mode).toBe('cache');
    expect(second.sha).toBe(first.sha);
    expect(
      releases.releases.kernel.map((record: { version: string }) => record.version).sort(),
    ).toEqual(['1.0.0', '1.1.0']);
    // The corpus was not pulled again: the index is the one the first start built.
    expect(statSync(second.indexFile ?? '').mtimeMs).toBe(indexed);
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

  test('offline, each ref falls back to the newest SHA pulled for that ref', async () => {
    const source = makeSourceRepository();
    const cwd = consumer();

    git({ cwd: source.work, args: ['checkout', '-q', '-b', 'main'] });
    writeSourceFile({
      work: source.work,
      path: 'docs/changelogs/2026-03-01-main.md',
      text: "---\ntitle: Main\npackages: ['@x/kernel']\n---\n\nOn main.\n",
    });
    commitAll({ work: source.work, message: 'docs: main' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'main'] });

    const develop = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const main = [{ name: 'src', repo: source.url, ref: 'main' }];
    const [onDevelop] = await resolveSources({ cwd, sources: develop });
    const [onMain] = await resolveSources({ cwd, sources: main });

    renameSync(source.bare, `${source.bare}.away`);

    const [offlineDevelop] = await resolveSources({ cwd, sources: develop });
    const [offlineMain] = await resolveSources({ cwd, sources: main });

    renameSync(`${source.bare}.away`, source.bare);
    expect(onMain.sha).not.toBe(onDevelop.sha);
    expect(offlineDevelop.mode).toBe('offline-cache');
    expect(offlineDevelop.sha).toBe(onDevelop.sha);
    expect(offlineMain.sha).toBe(onMain.sha);
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

  test('a fetched manifest whose package name is not an npm name stops, naming the source and the name', async () => {
    const source = makeSourceRepository();

    writeSourceFile({
      work: source.work,
      path: '.agents/vulcan.manifest.json',
      text: SOURCE_MANIFEST.replace('"@x/kernel"', '"../../../../escape"'),
    });
    commitAll({ work: source.work, message: 'chore: a bad name' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });

    const failure = await resolveSources({
      cwd: consumer(),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    }).then(
      () => undefined,
      (error: unknown) => String(error),
    );

    expect(failure).toContain(
      `atlas: source 'src' (${source.url}@develop) - package name '../../../../escape' is not an npm package name`,
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
      resolved.map((entry) => ({ mode: entry.mode, root: entry.root, name: entry.name })),
    ).toEqual([{ mode: 'repository', root: cwd, name: 'self' }]);
  });
});

describe('cacheRootOf', () => {
  const keyOf = (repo: string): string =>
    relative(join(process.env.XDG_CACHE_HOME ?? '', 'vulcan/atlas/v1'), cacheRootOf({ repo }));

  test('a GitHub source keeps its readable host/owner/repo', () => {
    expect(keyOf('VENIZIA-AI/ignis')).toBe('github.com/VENIZIA-AI/ignis');
    expect(keyOf('https://github.com/VENIZIA-AI/ignis.git')).toBe('github.com/VENIZIA-AI/ignis');
  });

  test('every other source is keyed by its whole path, so no two repositories share a cache', () => {
    expect(keyOf('file:///a/x/src.git')).not.toBe(keyOf('file:///b/x/src.git'));
    expect(keyOf('https://gitlab.com/group/one/repo.git')).toBe('gitlab.com/group/one/repo');
    expect(keyOf('https://gitlab.com/group/one/repo.git')).not.toBe(
      keyOf('https://gitlab.com/other/one/repo.git'),
    );
    expect(keyOf('git@gitlab.com:group/one/repo.git')).toBe('gitlab.com/group/one/repo');
    expect(keyOf('http://127.0.0.1:8080/acme/source.git')).toBe('127.0.0.1_8080/acme/source');
  });

  test('a path that climbs never leaves the cache', () => {
    expect(keyOf('https://host/../../../etc/repo.git').split('/')).not.toContain('..');
    expect(keyOf('file:///tmp/../x/./repo.git').split('/')).not.toContain('..');
  });
});
