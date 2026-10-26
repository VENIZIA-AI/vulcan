import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSourceLinks } from '../../wiki/index.ts';
import type { IMissingSourceLink } from '../../wiki/index.ts';
import { git } from '../git-repo.helper.ts';

const roots: string[] = [];

const write = (opts: { root: string; path: string; lines: string[] }): void => {
  const full = join(opts.root, opts.path);

  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${opts.lines.join('\n')}\n`);
};

// `git add` without a commit is enough: `git ls-files` reads the index of this disposable repository.
const trackedRepository = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-wiki-source-links-'));

  roots.push(root);
  git({ cwd: root, args: ['init', '--quiet'] });
  write({ root, path: 'packages/x/y.ts', lines: ['export const y = 1;'] });
  write({
    root,
    path: 'docs/a.md',
    lines: [
      '# Doc',
      '',
      'Tracked: https://github.com/VENIZIA-AI/acme/blob/main/packages/x/y.ts',
      'Untracked: https://github.com/VENIZIA-AI/acme/blob/main/packages/x/missing.ts',
      'Directory: https://github.com/VENIZIA-AI/acme/tree/main/packages/x',
      'Backtick: `packages/x/y.ts:42`',
      'External: https://github.com/other/repo/blob/main/packages/z.ts',
    ],
  });
  write({
    root,
    path: 'docs/changelogs/old.md',
    lines: ['# Changelog', '', 'Skipped prose: `packages/x/gone.ts`'],
  });
  write({
    root,
    path: 'docs/generated.md',
    lines: ['# Generated', '', 'A generated page: `packages/x/never.ts`'],
  });
  write({
    root,
    path: '.agents/knowledge/concept.md',
    lines: ['---', 'title: Test concept', 'resource: packages/x/y.ts', '---', '', 'Body.'],
  });
  write({
    root,
    path: '.agents/knowledge/stale.md',
    lines: ['---', 'title: Stale concept', 'resource: "packages/x/removed.ts"', '---', '', 'Body.'],
  });
  git({ cwd: root, args: ['add', '-A'] });

  return root;
};

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkSourceLinks', () => {
  let root = '';

  beforeAll(() => {
    root = trackedRepository();
  });

  const run = (opts: { repo: string; skipFiles?: string[] }) =>
    checkSourceLinks({
      root,
      repo: opts.repo,
      directories: ['docs', '.agents/knowledge'],
      skipProseUnder: ['docs/changelogs'],
      skipFiles: opts.skipFiles ?? ['docs/generated.md'],
    });

  test('flags the untracked GitHub link and the stale resource, and nothing else', () => {
    const missing: IMissingSourceLink[] = [
      { file: '.agents/knowledge/stale.md', line: 3, path: 'packages/x/removed.ts' },
      { file: 'docs/a.md', line: 4, path: 'packages/x/missing.ts' },
    ];

    expect(run({ repo: 'VENIZIA-AI/acme' }).missing).toEqual(missing);
  });

  test('counts the tracked link, the directory link, the backtick path and both resources', () => {
    expect(run({ repo: 'VENIZIA-AI/acme' }).checked).toBe(6);
  });

  test('the repository slug scopes the GitHub links: another slug sees none of them', () => {
    const result = run({ repo: 'VENIZIA-AI/other' });

    expect(result.missing.map((miss) => miss.path)).toEqual(['packages/x/removed.ts']);
    expect(result.checked).toBe(3);
  });

  test('a skipped file is never held to the gate, and a changelog may name history', () => {
    const files = run({ repo: 'VENIZIA-AI/acme', skipFiles: [] }).missing.map((miss) => miss.file);

    expect(files).toContain('docs/generated.md');
    expect(files).not.toContain('docs/changelogs/old.md');
  });

  test('a gitignored file on disk is not a valid target', () => {
    write({ root, path: 'docs/b.md', lines: ['Built: `packages/x/built.ts`'] });
    write({ root, path: 'packages/x/built.ts', lines: ['export {};'] });

    const files = run({ repo: 'VENIZIA-AI/acme' }).missing.map((miss) => miss.path);

    expect(files).toContain('packages/x/built.ts');
  });
});
