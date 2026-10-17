import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toAtlasProject } from '@/common/project-config';
import { AtlasReleases } from '@/releases/generator';

const ROOT = mkdtempSync(join(tmpdir(), 'atlas-order-'));

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const git = (opts: { args: string[] }): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...opts.args], {
    cwd: ROOT,
    stdio: 'ignore',
  });
};

const changelog = (opts: { file: string }): void => {
  writeFileSync(
    join(ROOT, 'changelogs', opts.file),
    '---\ntitle: A change\npackages: [kernel]\n---\n',
  );
};

const PROJECT = toAtlasProject({
  root: ROOT,
  manifest: {
    schemaVersion: 1,
    packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
    knowledge: { changelogs: 'changelogs' },
  },
});

const render = () => JSON.parse(AtlasReleases.render({ project: PROJECT }));

test('a table generated before its changelog is committed still reads fresh after the commit', () => {
  mkdirSync(join(ROOT, 'changelogs'));
  git({ args: ['init', '-q', '-b', 'develop'] });
  git({ args: ['commit', '-q', '--allow-empty', '-m', 'chore(kernel): release v1.0.0 [patch]'] });
  changelog({ file: '2026-01-02-a.md' });
  git({ args: ['add', '-A'] });
  git({ args: ['commit', '-q', '-m', 'docs: a'] });
  git({ args: ['commit', '-q', '--allow-empty', '-m', 'chore(kernel): release v1.1.0 [patch]'] });
  changelog({ file: '2026-01-03-b.md' });

  const before = AtlasReleases.render({ project: PROJECT });

  git({ args: ['add', '-A'] });
  git({ args: ['commit', '-q', '-m', 'docs: b'] });

  expect(AtlasReleases.render({ project: PROJECT })).toBe(before);
});

test('each changelog falls in the window after the release before it', () => {
  const table = render();
  const [newer, older] = table.releases.kernel;
  const orderOf = (opts: { file: string }): number =>
    table.changelogs.find((entry: { file: string }) => entry.file === opts.file).order;

  expect(orderOf({ file: '2026-01-02-a.md' })).toBeGreaterThan(older.order);
  expect(orderOf({ file: '2026-01-02-a.md' })).toBeLessThanOrEqual(newer.order);
  expect(orderOf({ file: '2026-01-03-b.md' })).toBeGreaterThan(newer.order);
});
