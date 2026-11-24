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
  const record = (opts: { root: string; name: string; entry: object }): void => {
    const file = join(opts.root, '.agents/local/cache/atlas/status.json');
    let sources: Record<string, object> = {};

    try {
      sources = JSON.parse(readFileSync(file, 'utf8')).sources;
    } catch {
      sources = {};
    }

    write({
      root: opts.root,
      path: '.agents/local/cache/atlas/status.json',
      text: JSON.stringify({ version: 1, sources: { ...sources, [opts.name]: opts.entry } }),
    });
  };

  test('says nothing was recorded when no server has started, and is no problem', () => {
    const root = project();

    expect(AtlasStatus.report({ root })).toContain('nothing yet: no atlas server has started here');
    expect(AtlasStatus.hasProblem({ root })).toBe(false);
  });

  test('one line per source: state, seconds, the usual build time and the last error; a failure is a problem', () => {
    const root = project();
    const now = Date.now();

    record({
      root,
      name: 'ignis',
      entry: { state: 'ready', since: now - 30_000, durationMs: 19_000 },
    });
    record({
      root,
      name: 'ardor',
      entry: { state: 'failed', since: now - 5000, error: 'the remote is down' },
    });

    const lines = AtlasStatus.recordedLines({ root, now });

    expect(lines[0]).toMatch(/^- ardor: failed for 5 s; last error: the remote is down$/);
    expect(lines[1]).toMatch(/^- ignis: ready for 30 s; a build usually takes about 19 s$/);
    expect(AtlasStatus.hasProblem({ root, now })).toBe(true);
  });

  test('a build running for over ten minutes is named and is a problem; a recent one is not', () => {
    const root = project();
    const now = Date.now();

    record({ root, name: 'ignis', entry: { state: 'building', since: now - 60_000 } });
    expect(AtlasStatus.hasProblem({ root, now })).toBe(false);
    record({ root, name: 'ignis', entry: { state: 'building', since: now - 11 * 60_000 } });
    expect(AtlasStatus.recordedLines({ root, now })[0]).toContain('over 10 minutes');
    expect(AtlasStatus.hasProblem({ root, now })).toBe(true);
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
