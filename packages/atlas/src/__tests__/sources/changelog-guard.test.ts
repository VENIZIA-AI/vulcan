import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import type { IReleaseTable } from '@/releases';
import { ChangelogGuard } from '@/sources/changelog-guard';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const projectIn = (opts: {
  files?: string[];
  folders?: Record<string, string | undefined>;
  declared?: boolean;
  folder?: boolean;
}) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-guard-'));

  roots.push(root);

  if (opts.folder !== false) {
    mkdirSync(join(root, 'changes'));
  }

  for (const file of opts.files ?? []) {
    writeFileSync(join(root, 'changes', file), '---\ntitle: x\n---\n');
  }

  for (const [folder, log] of Object.entries(opts.folders ?? {})) {
    mkdirSync(join(root, 'changes', folder));

    if (log !== undefined) {
      writeFileSync(join(root, 'changes', folder, 'log.md'), log);
    }
  }

  return ProjectConfig.toAtlasProject({
    root,
    manifest: {
      schemaVersion: 1,
      packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
      knowledge: opts.declared === false ? {} : { changelogs: 'changes' },
    },
  });
};

const table = (opts: { entries: number }): IReleaseTable => ({
  livePackages: ['kernel'],
  packageMap: [{ dir: 'kernel', name: '@a/kernel', aliases: [] }],
  releases: { kernel: [{ version: '1.0.0', date: '2026-01-01', sha: 'a', order: 0 }] },
  changelogs: Array.from({ length: opts.entries }, (_, index) => ({
    id: `changelog:2026-01-0${index + 1}-x`,
    file: `2026-01-0${index + 1}-x.md`,
    date: `2026-01-0${index + 1}`,
    title: 'x',
    packages: ['kernel'],
    kind: null,
  })),
});

describe('ChangelogGuard.check', () => {
  test('entries the commit holds that the checkout lacks are refused, naming the path and the count', () => {
    const project = projectIn({ folder: false });

    expect(() =>
      ChangelogGuard.check({
        project,
        releases: table({ entries: 0 }),
        label: 'ignis',
        committed: 375,
      }),
    ).toThrow(/ignis.*commits 375 dated entries in changes.*checkout holds none/s);
  });

  test('a folder declared before it holds an entry, in the checkout and in the commit, is fine', () => {
    expect(() =>
      ChangelogGuard.check({
        project: projectIn({ folder: false }),
        releases: table({ entries: 0 }),
        label: 's',
        committed: 0,
      }),
    ).not.toThrow();
    expect(() =>
      ChangelogGuard.check({
        project: projectIn({ folder: false }),
        releases: table({ entries: 0 }),
        label: 's',
      }),
    ).not.toThrow();
  });

  test('dated entries on disk that the release table does not carry are refused, counting them', () => {
    const project = projectIn({ files: ['2026-01-01-a.md', '2026-01-02-b.md', 'template.md'] });

    expect(() =>
      ChangelogGuard.check({ project, releases: table({ entries: 0 }), label: 'ignis' }),
    ).toThrow(/2 dated entries.*release table holds none/s);
  });

  test('an empty folder, entries in the table, or no declared folder pass', () => {
    expect(() =>
      ChangelogGuard.check({ project: projectIn({}), releases: table({ entries: 0 }), label: 's' }),
    ).not.toThrow();
    expect(() =>
      ChangelogGuard.check({
        project: projectIn({ files: ['2026-01-01-a.md'] }),
        releases: table({ entries: 1 }),
        label: 's',
      }),
    ).not.toThrow();
    expect(() =>
      ChangelogGuard.check({
        project: projectIn({ declared: false, folder: false }),
        releases: table({ entries: 0 }),
        label: 's',
      }),
    ).not.toThrow();
  });
});

describe('ChangelogGuard version folders', () => {
  test('datedIn counts dated files and a version folder once, never a plain name', () => {
    expect(
      ChangelogGuard.datedIn({
        names: ['changes/2026-01-01-a.md', 'changes/0.4.8', 'changes/index.md', 'changes/v1'],
      }),
    ).toBe(2);
  });

  test('datedIn skips a version folder that holds no log.md', () => {
    expect(
      ChangelogGuard.datedIn({
        names: ['changes/0.4.8', 'changes/0.4.9'],
        holdsLog: ({ folder }) => folder.endsWith('0.4.9'),
      }),
    ).toBe(1);
  });

  test('a source with only version folders is refused when the table holds none', () => {
    const project = projectIn({ folders: { '0.4.8': '---\ntitle: x\n---\n', '0.4.9': undefined } });

    expect(() =>
      ChangelogGuard.check({ project, releases: table({ entries: 0 }), label: 's' }),
    ).toThrow(/1 dated entries.*release table holds none/s);
  });
});
