import { describe, expect, test } from 'bun:test';
import { inspectGit } from '../../hooks/index.ts';
import type { IGitRunner } from '../../hooks/index.ts';

/** A fake `git`/`gh`: the current branch, the merged branches and the head branch of a pull request. */
const runner =
  (opts: { current?: string; merged?: string[]; head?: string }): IGitRunner =>
  (call) => {
    const text = [call.program, ...call.args].join(' ');

    if (text.includes('rev-parse')) {
      return opts.current;
    }

    if (text.includes('branch --merged')) {
      return opts.merged?.join('\n');
    }

    if (call.program === 'gh') {
      return opts.head;
    }

    return undefined;
  };
const decisions = (opts: { command: string; run?: IGitRunner }): string[] =>
  inspectGit({
    command: opts.command,
    cwd: '/p',
    run: opts.run ?? runner({ current: 'topic' }),
  }).map((hit) => hit.decision);

describe('inspectGit denies', () => {
  test.each([
    'git branch -D develop',
    'git branch -d main',
    'git branch --delete develop',
    'git push origin --delete develop',
    'git push origin :main',
    'git push --force origin develop',
    'git push -f origin main',
    'git push origin +develop',
    'git push origin HEAD:main --force-with-lease',
    'git -C /p push --force origin main',
    'cd x && git push -f origin develop',
    `bash -c 'git push --force origin main'`,
  ])('%s', (command) => {
    expect(decisions({ command })).toContain('deny');
  });

  test('a force-push with no refspec while on develop', () => {
    expect(
      decisions({ command: 'git push --force', run: runner({ current: 'develop' }) }),
    ).toContain('deny');
  });

  test('gh pr merge --delete-branch when the pull request head is develop', () => {
    expect(
      decisions({
        command: 'gh pr merge 12 --merge --delete-branch',
        run: runner({ head: 'develop' }),
      }),
    ).toEqual(['deny']);
  });
});

describe('inspectGit asks', () => {
  test('git reset --hard', () => {
    expect(decisions({ command: 'git reset --hard HEAD~1' })).toEqual(['ask']);
  });

  test('a force-push of another branch', () => {
    expect(decisions({ command: 'git push --force-with-lease origin topic' })).toEqual(['ask']);
  });

  test('branch -D of a branch that is not merged', () => {
    expect(
      decisions({ command: 'git branch -D topic', run: runner({ merged: ['develop', 'other'] }) }),
    ).toEqual(['ask']);
  });
});

describe('inspectGit passes', () => {
  test.each([
    'git status',
    'git push origin topic',
    'git push -u origin feature/x',
    'git branch -d topic',
    'git log --oneline -3',
    'git checkout develop',
    'git commit -m "delete the develop branch docs; push --force is banned"',
    'echo git push --force origin main',
    'grep -rn "branch -D develop" docs',
    'git reset --soft HEAD~1',
    'gh pr merge 12 --merge',
    'gh pr view 12',
  ])('%s', (command) => {
    expect(decisions({ command })).toEqual([]);
  });

  test('branch -D of a merged branch', () => {
    expect(
      decisions({ command: 'git branch -D topic', run: runner({ merged: ['topic', 'develop'] }) }),
    ).toEqual([]);
  });

  test('gh pr merge --delete-branch on a feature branch', () => {
    expect(
      decisions({
        command: 'gh pr merge 12 --merge --delete-branch',
        run: runner({ head: 'feature/x' }),
      }),
    ).toEqual([]);
  });

  test('a gh that cannot answer lets the merge through', () => {
    expect(
      decisions({ command: 'gh pr merge 12 --delete-branch', run: runner({ head: undefined }) }),
    ).toEqual([]);
  });

  test('every hit cites a rule', () => {
    const hits = inspectGit({ command: 'git reset --hard', cwd: '/p', run: runner({}) });

    expect(hits.every((hit) => /^V-[WP]-\d{2}$/.test(hit.rule))).toBe(true);
  });
});
