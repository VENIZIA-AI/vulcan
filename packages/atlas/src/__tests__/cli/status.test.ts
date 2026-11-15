import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
