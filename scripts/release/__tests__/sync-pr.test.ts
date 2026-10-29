import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MergeBackConstants, ReleaseMergeBack } from '../merge-back.ts';
import { ReleaseSyncPr } from '../sync-pr.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const git = (opts: { cwd: string; args: string[] }): string =>
  ReleaseMergeBack.mustGit({ cwd: opts.cwd, args: [...MergeBackConstants.IDENTITY, ...opts.args] });

const commit = (opts: { root: string; version: string; file?: string; message: string }): void => {
  const path = join(opts.root, 'packages', 'cli', 'package.json');

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ name: 'x', version: opts.version }, null, 2)}\n`);

  if (opts.file !== undefined) {
    writeFileSync(join(opts.root, opts.file), `${opts.message}\n`);
  }

  git({ cwd: opts.root, args: ['add', '-A'] });
  git({ cwd: opts.root, args: ['commit', '-q', '-m', opts.message] });
};

/** main at the last stable, develop two prerelease commits ahead of it, the second one tagged. */
const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'sync-pr-test-'));

  roots.push(root);
  git({ cwd: root, args: ['init', '-q', '-b', 'main'] });
  commit({ root, version: '0.4.8', message: 'chore(release): v0.4.8 [patch]' });
  git({ cwd: root, args: ['checkout', '-q', '-b', 'develop'] });
  commit({ root, version: '0.4.9-0', file: 'a.txt', message: '[#10] feat(a): first change' });
  commit({ root, version: '0.4.9-1', file: 'b.txt', message: '[#11] fix(b): second change' });
  git({ cwd: root, args: ['tag', '-a', 'vulcan-v0.4.9-1', '-m', 'gated'] });
  commit({ root, version: '0.4.9-2', file: 'c.txt', message: '[#12] feat(c): after the tag' });

  return root;
};

const check = (opts: { cwd: string; tag: string }) =>
  ReleaseSyncPr.check({ ...opts, main: 'main', develop: 'develop' });

describe('ReleaseSyncPr.check', () => {
  test('a gated prerelease tag on develop, with main inside it, can be synced, and the commits after the tag stay out', () => {
    const root = fixture();
    const checked = check({ cwd: root, tag: 'vulcan-v0.4.9-1' });

    expect(checked.problems).toEqual([]);
    expect(checked.version).toBe('0.4.9-1');
    expect(checked.commit).toBe(
      git({ cwd: root, args: ['rev-parse', 'vulcan-v0.4.9-1^{commit}'] }),
    );
    expect(checked.subjects).toEqual([
      '[#11] fix(b): second change',
      '[#10] feat(a): first change',
    ]);
  });

  test('a tag that does not exist is named', () => {
    expect(check({ cwd: fixture(), tag: 'vulcan-v9.9.9-0' }).problems[0]).toContain(
      'does not exist',
    );
  });

  test('a stable tag is refused: a Sync is cut from a gated prerelease', () => {
    const root = fixture();

    git({ cwd: root, args: ['tag', '-a', 'vulcan-v0.4.8', '-m', 'stable', 'main'] });

    expect(check({ cwd: root, tag: 'vulcan-v0.4.8' }).problems.join('\n')).toContain(
      'not a prerelease',
    );
  });

  test('a tag that is not in develop is refused', () => {
    const root = fixture();

    git({ cwd: root, args: ['checkout', '-q', '-b', 'elsewhere', 'main'] });
    commit({ root, version: '0.4.9-5', message: 'elsewhere' });
    git({ cwd: root, args: ['tag', '-a', 'vulcan-v0.4.9-5', '-m', 'x'] });
    git({ cwd: root, args: ['checkout', '-q', 'develop'] });

    expect(check({ cwd: root, tag: 'vulcan-v0.4.9-5' }).problems.join('\n')).toContain(
      'not in the history of develop',
    );
  });

  test('a main that holds commits the tag lacks is refused, with the way out', () => {
    const root = fixture();

    git({ cwd: root, args: ['checkout', '-q', 'main'] });
    commit({ root, version: '0.4.8', file: 'hotfix.txt', message: 'a commit made on main only' });
    git({ cwd: root, args: ['checkout', '-q', 'develop'] });

    expect(check({ cwd: root, tag: 'vulcan-v0.4.9-1' }).problems.join('\n')).toContain(
      'merge main back into develop first',
    );
  });
});

describe('ReleaseSyncPr: the branch, the title and the body', () => {
  test('the branch is sync/<tag>, so it is cut from the tag and not named develop', () => {
    expect(ReleaseSyncPr.branchOf({ tag: 'vulcan-v0.4.9-1' })).toBe('sync/vulcan-v0.4.9-1');
  });

  test('the body names the tag and its short commit and lists the commits it brings', () => {
    const body = ReleaseSyncPr.bodyOf({
      tag: 'vulcan-v0.4.9-1',
      version: '0.4.9-1',
      commit: 'abcdef0123456789',
      subjects: ['[#11] fix(b): second change'],
    });

    expect(ReleaseSyncPr.titleOf({ version: '0.4.9-1' })).toBe('Sync main: prerelease 0.4.9-1');
    expect(body).toContain('`vulcan-v0.4.9-1` (abcdef0)');
    expect(body).toContain('Brings 1 commit:');
    expect(body).toContain('- [#11] fix(b): second change');
  });
});

describe('ReleaseSyncPr.verify', () => {
  test('after the merge the tree of main is the tree of the tag', () => {
    const root = fixture();

    git({ cwd: root, args: ['checkout', '-q', 'main'] });
    git({ cwd: root, args: ['merge', '-q', '--no-ff', '-m', 'Sync', 'vulcan-v0.4.9-1'] });

    expect(ReleaseSyncPr.verify({ cwd: root, tag: 'vulcan-v0.4.9-1', main: 'main' })).toEqual([]);
  });

  test('a main that took develop past the tag instead has another tree, and is named', () => {
    const root = fixture();

    git({ cwd: root, args: ['checkout', '-q', 'main'] });
    git({ cwd: root, args: ['merge', '-q', '--no-ff', '-m', 'Sync', 'develop'] });

    expect(ReleaseSyncPr.verify({ cwd: root, tag: 'vulcan-v0.4.9-1', main: 'main' })[0]).toContain(
      'is not the tree',
    );
  });
});
