import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AtlasStatus } from '@/cli/status';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const write = (opts: { root: string; path: string; text: string }): void => {
  mkdirSync(dirname(join(opts.root, opts.path)), { recursive: true });
  writeFileSync(join(opts.root, opts.path), opts.text);
};

const project = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-status-'));

  roots.push(root);
  write({
    root,
    path: 'package.json',
    text: JSON.stringify({ name: 'app', dependencies: { '@venizia/ignis-helpers': '0.4.8-14' } }),
  });
  write({
    root,
    path: '.agents/vulcan.manifest.json',
    text: JSON.stringify({
      schemaVersion: 1,
      name: 'app',
      packages: [{ name: 'api', dir: 'api', path: 'services/api', aliases: [], retired: false }],
      knowledge: { bundle: '.agents/knowledge' },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'core-server-v0.4.8-16' }],
    }),
  });

  return root;
};

const install = (opts: { root: string; version: string }): void =>
  write({
    root: opts.root,
    path: 'node_modules/@venizia/ignis-helpers/package.json',
    text: JSON.stringify({ name: '@venizia/ignis-helpers', version: opts.version }),
  });

describe('vulcan x atlas status: what the last server run recorded', () => {
  const record = (opts: { root: string; name: string; entry: object; at?: string }): void => {
    const path = `${opts.at ?? '.agents/local/cache'}/atlas/status.json`;
    const file = join(opts.root, path);
    let sources: Record<string, object> = {};

    try {
      sources = JSON.parse(readFileSync(file, 'utf8')).sources;
    } catch {
      sources = {};
    }

    write({
      root: opts.root,
      path,
      text: JSON.stringify({ version: 1, sources: { ...sources, [opts.name]: opts.entry } }),
    });
  };
  const dead = (): boolean => false;
  const live = (): boolean => true;
  const kinds = (opts: { root: string; now: number; alive?: () => boolean }) =>
    AtlasStatus.problemsOf({ ...opts, alive: opts.alive ?? dead }).map(
      (problem) => `${problem.source}:${problem.kind}`,
    );

  test('says nothing was recorded when no server has started, and is no problem', () => {
    const root = project();

    expect(AtlasStatus.report({ root })).toContain('nothing yet: no atlas server has started here');
    expect(AtlasStatus.problemsOf({ root })).toEqual([]);
  });

  test('one line per declared source; a source never served that failed is a problem', () => {
    const root = project();
    const now = Date.now();

    record({
      root,
      name: 'ignis',
      entry: { state: 'failed', since: now - 5000, error: 'the remote is down' },
    });

    const lines = AtlasStatus.recordedLines({ root, now });

    expect(lines).toEqual(['- ignis: failed for 5 s; last error: the remote is down']);
    expect(kinds({ root, now })).toEqual(['ignis:failed']);
  });

  test('a failed check that left an older index serving is refresh-failed, not failed', () => {
    const root = project();
    const now = Date.now();

    record({
      root,
      name: 'ignis',
      entry: {
        state: 'failed',
        since: now,
        error: 'offline',
        resolved: { name: 'ignis' },
        durationMs: 19_000,
      },
    });
    expect(kinds({ root, now })).toEqual(['ignis:refresh-failed']);
    expect(AtlasStatus.recordedLines({ root, now })[0]).toContain(
      'the older index is served: offline',
    );
  });

  test('a build over ten minutes is hung only when its server is alive; otherwise it was left by a closed session', () => {
    const root = project();
    const now = Date.now();

    record({ root, name: 'ignis', entry: { state: 'building', since: now - 60_000, pid: 1 } });
    expect(kinds({ root, now, alive: live })).toEqual([]);
    record({ root, name: 'ignis', entry: { state: 'building', since: now - 11 * 60_000, pid: 1 } });
    expect(kinds({ root, now, alive: live })).toEqual(['ignis:hung']);
    expect(kinds({ root, now, alive: dead })).toEqual(['ignis:abandoned']);
    record({ root, name: 'ignis', entry: { state: 'building', since: now - 11 * 60_000 } });
    expect(kinds({ root, now, alive: live })).toEqual(['ignis:abandoned']);
  });

  test('a source the config no longer declares is not shown and is no problem', () => {
    const root = project();
    const now = Date.now();

    record({ root, name: 'removed', entry: { state: 'failed', since: now, error: 'x' } });
    expect(AtlasStatus.recordedLines({ root, now })).toEqual([]);
    expect(AtlasStatus.problemsOf({ root, now })).toEqual([]);
  });

  test('a custom cache folder is found through the pointer a server left, and by --cache-dir', () => {
    const root = project();
    const now = Date.now();

    record({
      root,
      name: 'ignis',
      entry: { state: 'failed', since: now, error: 'x' },
      at: 'elsewhere',
    });
    expect(AtlasStatus.problemsOf({ root, now })).toEqual([]);
    expect(AtlasStatus.problemsOf({ root, now, cacheDir: 'elsewhere' })).toHaveLength(1);
    write({ root, path: '.agents/local/atlas-cache-base', text: `${join(root, 'elsewhere')}\n` });
    expect(AtlasStatus.problemsOf({ root, now })).toHaveLength(1);
  });
});

describe('vulcan x atlas status', () => {
  test('names the copy of each package atlas reads, with its version and folder', () => {
    const root = project();

    install({ root, version: '0.4.8-14' });

    const text = AtlasStatus.report({ root });

    expect(text).toContain('@venizia/ignis-helpers 0.4.8-14');
    expect(text).toContain('node_modules/@venizia/ignis-helpers');
    expect(text).not.toContain('also installed');
  });

  test('lists every other copy it found, and says when one differs in version', () => {
    const root = project();

    install({ root, version: '0.4.8-13' });
    install({ root: join(root, 'services/api'), version: '0.4.8-14' });

    const text = AtlasStatus.report({ root });

    expect(text).toContain('@venizia/ignis-helpers 0.4.8-13');
    expect(text).toContain(
      'also installed: services/api/node_modules/@venizia/ignis-helpers 0.4.8-14',
    );
    expect(text).toContain('the versions differ');
  });

  test('names the sources of the project, and a package that is not installed', () => {
    const root = project();
    const text = AtlasStatus.report({ root });

    expect(text).toContain('ignis: VENIZIA-AI/ignis@core-server-v0.4.8-16');
    expect(text).toContain('@venizia/ignis-helpers: not installed');
  });
});
