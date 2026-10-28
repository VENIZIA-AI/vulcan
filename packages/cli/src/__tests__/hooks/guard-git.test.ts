import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
    'env --split "git push -f origin main"',
    'env -S "-u X git push -f origin main"',
    "env -S 'git\\_push\\_-f\\_origin\\_main'",
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

  test('a line the parser could not read in full asks, never allows', () => {
    const deep = `env${' -S env'.repeat(110)} git push -f origin main`;
    const wide = Array.from({ length: 2100 }, () => 'ls').join('; ');
    const started = performance.now();

    for (const command of [
      deep,
      wide,
      'echo $(echo $(echo $(echo $(echo $(echo ls)))))',
      'eval eval eval eval eval eval ls',
    ]) {
      expect(decisions({ command })).toContain('ask');
    }

    expect(performance.now() - started).toBeLessThan(2000);
    expect(decisions({ command: 'git status' })).toEqual([]);
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

// A formatter run followed by `git add -A` once committed 152 files nobody meant to stage. A blanket stage asks only when it
// would stage a lot (the threshold is HookConstants.BLANKET_STAGE_PATHS): on this repository's develop, 2.2% of commits
// touch more than 50 files, and the median is 7, so a small pull request is never asked about.
describe('inspectGit asks before a blanket stage that is large', () => {
  /** A fake `git status --porcelain` of `tracked` modified paths and `untracked` new ones; counts the queries made. */
  const status = (opts: { tracked: number; untracked: number }) => {
    const calls: string[] = [];
    const run: IGitRunner = (call) => {
      calls.push([call.program, ...call.args].join(' '));

      if (call.args[0] === 'status') {
        return [
          ...Array.from({ length: opts.tracked }, (_, index) => ` M src/file-${index}.ts`),
          ...Array.from({ length: opts.untracked }, (_, index) => `?? new/file-${index}.ts`),
        ].join('\n');
      }

      return undefined;
    };

    return { run, calls };
  };
  const answer = (opts: { command: string; tracked: number; untracked?: number }) => {
    const fake = status({ tracked: opts.tracked, untracked: opts.untracked ?? 0 });
    const hits = inspectGit({ command: opts.command, cwd: '/p', run: fake.run });

    return { hits, calls: fake.calls };
  };

  test.each([
    'git add -A',
    'git add --all',
    'git add .',
    'git add -A -v',
    'git -C /p add -A',
    'git add -u',
    'git add --update',
    'git commit -a -m "x"',
    'git commit -am "x"',
    'git commit --all -m "x"',
    'git commit -sam "x"',
  ])('%s asks when it would stage 161 paths, and says how many', (command) => {
    const { hits } = answer({ command, tracked: 161 });

    expect(hits.map((hit) => hit.decision)).toEqual(['ask']);
    expect(hits[0].message).toContain('161');
    expect(hits[0].message).toContain('name the files');
  });

  test.each(['git add -A', 'git add --all', 'git add .', 'git commit -a -m "x"', 'git add -u'])(
    '%s is quiet at 50 paths and asks at 51',
    (command) => {
      expect(answer({ command, tracked: 50 }).hits).toEqual([]);
      expect(answer({ command, tracked: 51 }).hits.map((hit) => hit.decision)).toEqual(['ask']);
    },
  );

  test('git add -A counts new files too; git add -u and git commit -a count only tracked ones', () => {
    expect(answer({ command: 'git add -A', tracked: 20, untracked: 40 }).hits).toHaveLength(1);
    expect(answer({ command: 'git add -u', tracked: 20, untracked: 400 }).hits).toEqual([]);
    expect(answer({ command: 'git commit -a -m x', tracked: 20, untracked: 400 }).hits).toEqual([]);
  });

  test.each([
    'git add src/a.ts src/b.ts',
    'git add -A src',
    'git add -p',
    'git add -N src/a.ts',
    'git commit -m "x"',
    'git commit --amend --no-edit',
    'git commit --allow-empty -m x',
    'git status',
    'git diff --stat',
  ])('%s is never a blanket stage: no ask, and git is not even queried', (command) => {
    const { hits, calls } = answer({ command, tracked: 300, untracked: 300 });

    expect(hits).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('a status that cannot be read lets the command pass', () => {
    const run: IGitRunner = () => undefined;

    expect(inspectGit({ command: 'git add -A', cwd: '/p', run })).toEqual([]);
  });

  test('inside a compound command: asked once for the add, not for the commit without -a', () => {
    const { hits } = answer({ command: 'cd /p && git add -A && git commit -m "x"', tracked: 161 });

    expect(hits.map((hit) => hit.decision)).toEqual(['ask']);
  });

  test('the ask names the rule of the shared write and never denies', () => {
    const { hits } = answer({ command: 'git add -A', tracked: 161 });

    expect(hits[0].rule).toBe('V-W-06');
    expect(hits.some((hit) => hit.decision === 'deny')).toBe(false);
  });
});

// `git status --porcelain` prints a new folder as one line, so counting its lines undercounts the files a blanket stage
// would take. These tests use a real repository: the fake status of the block above has one line per file and could not see it.
describe('a blanket stage is counted file by file on a real repository', () => {
  const git = (opts: { cwd: string; args: string[] }): void => {
    expect(Bun.spawnSync(['git', ...opts.args], { cwd: opts.cwd }).exitCode).toBe(0);
  };
  const repository = (opts: { tracked?: number } = {}): string => {
    const files: Record<string, string> = { 'a.txt': 'a', '.gitignore': 'ignored/\n' };

    for (let index = 0; index < (opts.tracked ?? 0); index += 1) {
      files[`tracked/t${index}.txt`] = 'old';
    }

    const root = createProject({ files });

    git({ cwd: root, args: ['init', '-q', '-b', 'topic'] });
    git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
    git({ cwd: root, args: ['config', 'user.name', 'a'] });
    git({ cwd: root, args: ['add', '.'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'init'] });

    return root;
  };
  const files = (opts: { root: string; folder: string; count: number; text?: string }): void => {
    mkdirSync(join(opts.root, opts.folder), { recursive: true });

    for (let index = 0; index < opts.count; index += 1) {
      writeFileSync(join(opts.root, opts.folder, `f${index}.txt`), opts.text ?? 'new');
    }
  };
  const asks = (opts: { root: string; command: string }): string[] =>
    inspectGit({ command: opts.command, cwd: opts.root }).map((hit) => hit.decision);

  test('60 new files in ONE new folder: git add -A and git add . ask', () => {
    const root = repository();

    files({ root, folder: 'fresh', count: 60 });

    expect(asks({ root, command: 'git add -A' })).toEqual(['ask']);
    expect(asks({ root, command: 'git add .' })).toEqual(['ask']);
  });

  test('50 new files in one new folder are quiet, 51 ask: the threshold counts files, not folders', () => {
    const root = repository();

    files({ root, folder: 'fresh', count: 50 });
    expect(asks({ root, command: 'git add -A' })).toEqual([]);

    files({ root, folder: 'fresh', count: 51 });
    expect(asks({ root, command: 'git add -A' })).toEqual(['ask']);
  });

  test('files spread over several new folders add up', () => {
    const root = repository();

    for (const folder of ['one', 'two', 'three']) {
      files({ root, folder, count: 20 });
    }

    expect(asks({ root, command: 'git add -A' })).toEqual(['ask']);
  });

  test('modified tracked files and new files add up for -A', () => {
    const root = repository({ tracked: 30 });

    for (let index = 0; index < 30; index += 1) {
      writeFileSync(join(root, `tracked/t${index}.txt`), 'changed');
    }

    files({ root, folder: 'fresh', count: 30 });

    expect(asks({ root, command: 'git add -A' })).toEqual(['ask']);
    expect(asks({ root, command: 'git add -u' })).toEqual([]);
    expect(asks({ root, command: 'git commit -am x' })).toEqual([]);
  });

  test('the formatter case: 60 modified tracked files ask for -u and for commit -a', () => {
    const root = repository({ tracked: 60 });

    for (let index = 0; index < 60; index += 1) {
      writeFileSync(join(root, `tracked/t${index}.txt`), 'formatted');
    }

    expect(asks({ root, command: 'git add -u' })).toEqual(['ask']);
    expect(asks({ root, command: 'git commit -am x' })).toEqual(['ask']);
  });

  test('ignored files are not counted', () => {
    const root = repository();

    files({ root, folder: 'ignored', count: 200 });
    files({ root, folder: 'fresh', count: 5 });

    expect(asks({ root, command: 'git add -A' })).toEqual([]);
  });
});
