import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toAtlasProject } from '@/common/project-config';
import { computeReleases } from '@/releases';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const scratch = (): {
  root: string;
  git: (args: string[]) => void;
  write: (path: string, text: string) => void;
} => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-compute-'));

  roots.push(root);
  mkdirSync(join(root, 'changes'));

  const git = (args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };
  const write = (path: string, text: string): void => writeFileSync(join(root, path), text);

  git(['init', '-q', '-b', 'develop']);

  return { root, git, write };
};

const PACKAGES = [
  { name: '@a/kernel', dir: 'kernel', aliases: [], retired: false },
  { name: '@a/web', dir: 'web', aliases: [], retired: false },
];

const projectAt = (opts: { root: string; release?: object }) =>
  toAtlasProject({
    root: opts.root,
    manifest: {
      schemaVersion: 1,
      packages: PACKAGES,
      knowledge: { changelogs: 'changes' },
      release: opts.release ?? { tagPattern: '<dir>-v<version>', ignoreTags: ['old/*'] },
    },
  });

const changelog = (opts: { title: string; extra?: string }): string =>
  `---\ntitle: ${opts.title}\npackages: ['@a/kernel']\n${opts.extra ?? ''}---\n\nA change.\n`;

describe('computeReleases (D1)', () => {
  // develop: init, kernel 1.0.0, changelog a, merge of a branch tagged web 0.1.0, kernel 1.1.0,
  // a's rename, a backfill pointing at kernel 1.0.0; tags no package matches, or ignored.
  const { root, git, write } = scratch();

  git(['commit', '-q', '--allow-empty', '-m', 'init']);
  git(['commit', '-q', '--allow-empty', '-m', 'chore(kernel): release v1.0.0 [patch]']);
  git(['tag', 'kernel-v1.0.0']);
  write('changes/2026-01-02-a.md', changelog({ title: 'A' }));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: a']);
  git(['switch', '-q', '-c', 'feature']);
  git(['commit', '-q', '--allow-empty', '-m', 'chore(web): release v0.1.0 [patch]']);
  git(['tag', '-a', 'web-v0.1.0', '-m', 'web 0.1.0']);
  git(['switch', '-q', 'develop']);
  git(['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature']);
  git(['commit', '-q', '--allow-empty', '-m', 'chore(kernel): release v1.1.0 [patch]']);
  git(['tag', '-a', 'kernel-v1.1.0', '-m', 'kernel 1.1.0']);
  git(['mv', 'changes/2026-01-02-a.md', 'changes/2026-01-02-a-renamed.md']);
  git(['commit', '-q', '-m', 'docs: rename a']);
  write(
    'changes/2026-01-01-backfill.md',
    changelog({ title: 'Backfill', extra: "release: '@a/kernel@1.0.0'\n" }),
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: backfill']);
  git(['tag', 'old/0.0.1-0']);
  git(['tag', 'ghost-v1.0.0']);

  const table = computeReleases({ project: projectAt({ root }) });
  const orderOf = (opts: { dir: string; version: string }): number =>
    table.releases[opts.dir]?.find(record => record.version === opts.version)?.order ?? -1;
  const entryOrder = (opts: { file: string }): number =>
    table.changelogs.find(entry => entry.file === opts.file)?.order ?? -1;

  test('every tag matching the pattern is a release; ignored tags and unknown packages are not', () => {
    expect(Object.keys(table.releases).sort()).toEqual(['kernel', 'web']);
    expect(table.releases.kernel.map(record => record.version)).toEqual(['1.1.0', '1.0.0']);
    expect(table.releases.web.map(record => record.version)).toEqual(['0.1.0']);
  });

  test('a tag on a merged branch takes the position of the merge that brought it in', () => {
    const web = orderOf({ dir: 'web', version: '0.1.0' });

    expect(web).toBeGreaterThan(orderOf({ dir: 'kernel', version: '1.0.0' }));
    expect(web).toBeLessThan(orderOf({ dir: 'kernel', version: '1.1.0' }));
  });

  test('a renamed changelog keeps the window of the commit that first added it', () => {
    const renamed = entryOrder({ file: '2026-01-02-a-renamed.md' });

    expect(renamed).toBeGreaterThan(orderOf({ dir: 'kernel', version: '1.0.0' }));
    expect(renamed).toBeLessThanOrEqual(orderOf({ dir: 'kernel', version: '1.1.0' }));
  });

  test("a release override places a backfill in its release's window", () => {
    expect(entryOrder({ file: '2026-01-01-backfill.md' })).toBe(
      orderOf({ dir: 'kernel', version: '1.0.0' }),
    );
  });

  test("a renamed package's old tags are its own history: the tag's directory resolves through aliases", () => {
    const renamed = scratch();

    renamed.git(['commit', '-q', '--allow-empty', '-m', 'old']);
    renamed.git(['tag', 'core-v0.1.0']);
    renamed.git(['commit', '-q', '--allow-empty', '-m', 'new']);
    renamed.git(['tag', 'core-server-v0.2.0']);

    const renamedTable = computeReleases({
      project: toAtlasProject({
        root: renamed.root,
        manifest: {
          schemaVersion: 1,
          packages: [{ name: '@a/server', dir: 'core-server', aliases: ['core'], retired: false }],
        },
      }),
    });

    expect(renamedTable.releases['core-server']?.map(record => record.version)).toEqual([
      '0.2.0',
      '0.1.0',
    ]);
  });

  test('a merge that repeats a release subject is no second release - the tag names one commit', () => {
    const merged = scratch();

    merged.git(['commit', '-q', '--allow-empty', '-m', 'init']);
    merged.git(['switch', '-q', '-c', 'release']);
    merged.git(['commit', '-q', '--allow-empty', '-m', 'chore(kernel): release v1.0.0 [patch]']);
    merged.git(['tag', '-a', 'kernel-v1.0.0', '-m', 'kernel 1.0.0']);
    merged.git(['switch', '-q', 'develop']);
    merged.git([
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'chore(kernel): release v1.0.0 [patch]',
      'release',
    ]);

    const mergedTable = computeReleases({ project: projectAt({ root: merged.root }) });

    expect(mergedTable.releases.kernel?.map(record => record.version)).toEqual(['1.0.0']);
  });

  test('a repo-level pattern (no <dir>) releases every live package at once', () => {
    const repo = scratch();

    repo.git(['commit', '-q', '--allow-empty', '-m', 'release']);
    repo.git(['tag', '2026-01-05_v1.0.0']);

    const repoTable = computeReleases({
      project: projectAt({ root: repo.root, release: { tagPattern: '<date>_v<version>' } }),
    });

    expect(repoTable.releases.kernel?.map(record => record.version)).toEqual(['1.0.0']);
    expect(repoTable.releases.web?.map(record => record.version)).toEqual(['1.0.0']);
  });
});

describe('computeReleases on the edges of a repository', () => {
  test('a repository with no commit yet has no history: the empty table', () => {
    const empty = scratch();

    expect(computeReleases({ project: projectAt({ root: empty.root }) })).toEqual({
      livePackages: ['kernel', 'web'],
      releases: {},
      changelogs: [],
      packageMap: PACKAGES.map(entry => ({
        dir: entry.dir,
        name: entry.name,
        aliases: entry.aliases,
      })),
    });
  });

  test('a CRLF changelog still declares its packages', () => {
    const crlf = scratch();

    crlf.write(
      'changes/2026-01-01-crlf.md',
      "---\r\ntitle: Crlf\r\npackages: ['@a/web']\r\n---\r\n\r\nA change.\r\n",
    );
    crlf.git(['add', '-A']);
    crlf.git(['commit', '-q', '-m', 'docs: crlf']);

    const crlfTable = computeReleases({ project: projectAt({ root: crlf.root }) });

    expect(
      crlfTable.changelogs.map(entry => ({ title: entry.title, packages: entry.packages })),
    ).toEqual([{ title: 'Crlf', packages: ['web'] }]);
  });
});
