import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectGit } from '../../hooks/index.ts';
import type { IGitRunner } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

/** A fake `git`/`gh`: the current branch, the merged branches and the head branch of a pull request. */
const runner =
  (opts: { current?: string; merged?: string[]; head?: string }): IGitRunner =>
  (call) => {
    const text = [call.program, ...call.args].join(' ');

    if (text.includes('rev-parse')) {
      return opts.current;
    }

    if (text.includes('branch') && text.includes('--merged')) {
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
    'git push -fu origin develop',
    'git push -uf origin main',
    'env -u X git branch -D develop',
    'sudo -u deploy git push -f origin main',
    'nice -n 5 git push -f origin main',
    'env -S "git push -f origin main"',
    "env -S'git push --force origin develop'",
    'env --split-string="git push -f origin main"',
    'sudo env -S "git push -f origin main"',
    'env -S "git branch -D develop"',
    'sudo -E git push -f origin main',
    'sudo -n git push -f origin main',
    'sudo -nu root git push -f origin main',
    'sudo -E -u deploy git push -f origin main',
    'env -i git push -f origin main',
    'env -i FOO=1 git push -f origin main',
    'doas -u root git push -f origin main',
    'timeout 5 git push -f origin main',
    'timeout -k 3 10 git push -f origin main',
    'watch -n 2 git push -f origin main',
    'xargs -0 git push -f origin main',
    'exec -c git push -f origin main',
    'command -p git push -f origin main',
    'time -p git push -f origin main',
    'stdbuf -oL git push -f origin main',
    'setsid git push -f origin main',
    'ionice -c 3 git push -f origin main',
    '{ git push -f origin main; }',
    'if true; then git push -f origin main; fi',
    `sh -lc "git push -f origin main"`,
    `eval "git push -f origin main"`,
    'xargs git push -f origin main',
    'git branch -m develop old-develop',
    'git branch --move main x',
    'git update-ref -d refs/heads/develop',
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
  test('git push --mirror', () => {
    expect(decisions({ command: 'git push --mirror origin' })).toEqual(['ask']);
  });

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
  test('a heredoc commit message that mentions a force-push is data, not a command', () => {
    const message = [
      "git commit -m \"$(cat <<'EOF'",
      '[#1] fix: never',
      'git push -f origin main',
      'git branch -D develop',
      'EOF',
      ')"',
    ].join('\n');

    expect(decisions({ command: message })).toEqual([]);
    expect(decisions({ command: 'cat <<EOF\ngit branch -D develop\nEOF' })).toEqual([]);
  });

  test('a command after a heredoc is still read', () => {
    expect(decisions({ command: 'cat <<EOF\nnote\nEOF\ngit push -f origin main' })).toContain(
      'deny',
    );
  });

  test.each([
    'git push -u origin topic',
    'git branch -m topic better-topic',
    'git update-ref refs/heads/topic HEAD',
    'env -u X git status',
    'xargs echo git push -f origin main',
  ])('and %s passes', (command) => {
    expect(decisions({ command })).toEqual([]);
  });

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

describe('inspectGit against a real repository', () => {
  const git = (opts: { cwd: string; args: string[] }): void => {
    expect(Bun.spawnSync(['git', ...opts.args], { cwd: opts.cwd }).exitCode).toBe(0);
  };
  const repository = (): string => {
    const root = createProject({ files: { 'a.txt': 'a' } });

    git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
    git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
    git({ cwd: root, args: ['config', 'user.name', 'a'] });
    git({ cwd: root, args: ['add', '.'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'init'] });

    return root;
  };

  test('branch -D asks for an unmerged branch and passes a merged one, with the real git', () => {
    const root = repository();

    git({ cwd: root, args: ['checkout', '-q', '-b', 'unmerged'] });
    writeFileSync(join(root, 'b.txt'), 'b');
    git({ cwd: root, args: ['add', '.'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'work'] });
    git({ cwd: root, args: ['checkout', '-q', 'develop'] });
    git({ cwd: root, args: ['branch', 'merged'] });

    const askFor = (name: string): string[] =>
      inspectGit({ command: `git branch -D ${name}`, cwd: root }).map((hit) => hit.decision);

    expect(askFor('unmerged')).toEqual(['ask']);
    expect(askFor('merged')).toEqual([]);
  });
});
