import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HooksPin } from '../../hooks/hooks-pin.ts';
import { installBundle } from '../bundle.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const git = (opts: { root: string; args: string[] }): void => {
  const result = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.email=t@t.t',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      ...opts.args,
    ],
    { cwd: opts.root },
  );

  expect(result.exitCode, opts.args.join(' ')).toBe(0);
};

/** A repository whose HEAD records the sums of a bundle, as the owner's commit left it, with a package.json and a bun.lock that name the package. */
const project = (): string => {
  const root = createProject({
    files: {
      'package.json':
        JSON.stringify(
          { dependencies: { '@venizia/vulcan': '^0.5.0', 'left-pad': '1.0.0' } },
          null,
          2,
        ) + '\n',
      'bun.lock':
        '"@venizia/vulcan": ["@venizia/vulcan@0.5.0", ""]\n"left-pad": ["left-pad@1.0.0", ""]\n',
      'src/a.ts': 'x\n',
    },
  });

  installBundle({ root });
  git({ root, args: ['add', 'package.json', 'bun.lock', 'src'] });
  git({ root, args: ['commit', '-q', '-m', 'base'] });

  return root;
};

const manifestPath = (root: string): string => join(root, '.agents', 'vulcan.manifest.json');

/** The manifest with the sum of one file changed. */
const withNewSum = (root: string): string => {
  const manifest = JSON.parse(readFileSync(manifestPath(root), 'utf8'));

  manifest.hooks.sha256['guard-git.js'] = '0'.repeat(64);

  return `${JSON.stringify(manifest, null, 2)}\n`;
};

const asks = (opts: { root: string; command: string }): boolean =>
  HooksPin.inspectCommand({ command: opts.command, cwd: opts.root }).some(
    (hit) => hit.decision === 'ask',
  );

describe('a commit that changes what the hooks are checked against asks', () => {
  test('a staged change of the hooks block asks, for a commit and for an amend', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));
    git({ root, args: ['add', '.agents/vulcan.manifest.json'] });

    for (const command of [
      'git commit -m x',
      'git commit --amend --no-edit',
      'git commit -S -m x',
      'git -C . commit -m x',
      'cd . && git commit -m x',
    ]) {
      expect(asks({ root, command }), command).toBe(true);
    }
  });

  test('a change in the working tree only asks for `commit -a`, `-am`, --all and a named file, not for a plain commit', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));

    expect(asks({ root, command: 'git commit -m x' })).toBe(false);

    for (const command of [
      'git commit -a -m x',
      'git commit -am x',
      'git commit --all -m x',
      'git commit -m x .agents/vulcan.manifest.json',
    ]) {
      expect(asks({ root, command }), command).toBe(true);
    }
  });

  test('a change of the lines that name the package in package.json or bun.lock asks', () => {
    for (const [file, from, to] of [
      ['package.json', '"^0.5.0"', '"file:./evil"'],
      ['bun.lock', '@venizia/vulcan@0.5.0', '@venizia/vulcan@file:evil'],
    ] as const) {
      const root = project();
      const path = join(root, file);

      writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
      git({ root, args: ['add', file] });

      expect(asks({ root, command: 'git commit -m x' }), file).toBe(true);
    }
  });

  test('an ordinary commit, a change to another dependency and a commit with nothing staged pass', () => {
    const root = project();

    writeFileSync(join(root, 'src', 'a.ts'), 'y\n');
    git({ root, args: ['add', 'src/a.ts'] });

    expect(asks({ root, command: 'git commit -m x' })).toBe(false);
    expect(asks({ root, command: 'git commit -am x' })).toBe(false);

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        { dependencies: { '@venizia/vulcan': '^0.5.0', 'left-pad': '1.0.1' } },
        null,
        2,
      ) + '\n',
    );
    git({ root, args: ['add', 'package.json'] });

    expect(asks({ root, command: 'git commit -m x' })).toBe(false);
  });

  test('a stash pop or apply that brings a change in asks, one that does not passes', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));
    git({ root, args: ['stash', '-q'] });

    for (const command of [
      'git stash pop',
      'git stash apply',
      'git stash pop stash@{0}',
      'git stash apply stash@{0}',
    ]) {
      expect(asks({ root, command }), command).toBe(true);
    }

    expect(asks({ root, command: 'git stash list' })).toBe(false);
    expect(asks({ root, command: 'git stash' })).toBe(false);

    const plain = project();

    writeFileSync(join(plain, 'src', 'a.ts'), 'z\n');
    git({ root: plain, args: ['stash', '-q'] });

    expect(asks({ root: plain, command: 'git stash pop' })).toBe(false);
  });

  test('other git commands and other programs pass', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));
    git({ root, args: ['add', '.agents/vulcan.manifest.json'] });

    for (const command of [
      'git status',
      'git diff --cached',
      'git log -1',
      'git add -A',
      'echo git commit -m x',
      'ls',
    ]) {
      expect(asks({ root, command }), command).toBe(false);
    }
  });
});

describe('guard-git runs the pin check', () => {
  test('through the hook: a commit that changes the sums asks, and is denied where every ask is', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));
    git({ root, args: ['add', '.agents/vulcan.manifest.json'] });

    const answerOf = (env: Record<string, string>): string =>
      Bun.spawnSync(
        [
          process.execPath,
          join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-git.ts'),
        ],
        {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, VULCAN_GUARD_ASKS: '', ...env },
          stdin: new Blob([
            `{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"cwd":"${root}"}`,
          ]),
        },
      ).stdout.toString();

    expect(answerOf({})).toContain('"permissionDecision":"ask"');
    expect(answerOf({})).toContain('hooks block of the manifest');
    expect(answerOf({ VULCAN_GUARD_ASKS: 'deny' })).toContain('"permissionDecision":"deny"');
  });
});

const gitOut = (opts: { root: string; args: string[] }): string => {
  const result = Bun.spawnSync(['git', ...opts.args], { cwd: opts.root });

  return result.stdout.toString().trim();
};

/** A branch `topic` that changes the sums, and one `quiet` that changes something else; the project stays on main. */
const withBranches = (): string => {
  const root = project();

  git({ root, args: ['checkout', '-q', '-b', 'quiet'] });
  writeFileSync(join(root, 'src', 'a.ts'), 'quiet\n');
  git({ root, args: ['commit', '-q', '-am', 'quiet change'] });
  git({ root, args: ['checkout', '-q', 'main'] });
  git({ root, args: ['checkout', '-q', '-b', 'topic'] });
  writeFileSync(manifestPath(root), withNewSum(root));
  git({ root, args: ['commit', '-q', '-am', 'new sums'] });
  git({ root, args: ['checkout', '-q', 'main'] });

  return root;
};

const decisionsOf = (opts: { root: string; command: string }): string[] =>
  HooksPin.inspectCommand({ command: opts.command, cwd: opts.root }).map((hit) => hit.decision);

describe('git plumbing and an alias on the command line are denied', () => {
  test.each([
    'git replace HEAD~0 HEAD',
    'git replace -d abc',
    'git update-ref refs/heads/x HEAD',
    'git update-ref -d refs/heads/x',
    'git commit-tree HEAD^{tree} -m x',
    'git symbolic-ref HEAD refs/heads/x',
    'git -C . replace a b',
    'cd . && git update-ref refs/heads/x HEAD',
    'git -c alias.ci=commit ci -am x',
    'git -c Alias.x=!sh x',
    'git -c user.name=a -c alias.s=status s',
  ])('%s is denied', (command) => {
    expect(decisionsOf({ root: project(), command })).toEqual(['deny']);
  });

  test.each(['git -c user.name=a commit -m x', 'git -c core.pager=cat log -1', 'git status'])(
    '%s is not',
    (command) => {
      expect(decisionsOf({ root: project(), command })).not.toContain('deny');
    },
  );
});

describe('an alias of the repository is resolved', () => {
  test('an alias of commit is read as a commit, and a shell alias asks', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));
    git({ root, args: ['add', '.agents/vulcan.manifest.json'] });
    git({ root, args: ['config', 'alias.ci', 'commit'] });
    git({ root, args: ['config', 'alias.sh', '!sh -c true'] });

    expect(decisionsOf({ root, command: 'git ci -m x' })).toEqual(['ask']);
    expect(decisionsOf({ root, command: 'git sh' })).toEqual(['ask']);
    expect(decisionsOf({ root, command: 'git status' })).toEqual([]);
  });

  test('an alias with arguments keeps them: commit -a', () => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));
    git({ root, args: ['config', 'alias.cia', 'commit -a'] });

    expect(decisionsOf({ root, command: 'git cia -m x' })).toEqual(['ask']);
  });
});

describe('a line that stages and then commits is judged by the working tree', () => {
  test.each([
    'git add -A && git commit -m x',
    'git add .agents && git commit -m x',
    'git add .agents/vulcan.manifest.json; git commit -m x',
    'git add -A && git commit --amend --no-edit',
    'git rm -q src/a.ts && git commit -m x',
    'git update-index --add .agents/vulcan.manifest.json && git commit -m x',
  ])('%s asks when the working tree changes the sums', (command) => {
    const root = project();

    writeFileSync(manifestPath(root), withNewSum(root));

    expect(decisionsOf({ root, command })).toEqual(['ask']);
  });

  test('and passes when it does not', () => {
    const root = project();

    writeFileSync(join(root, 'src', 'a.ts'), 'changed\n');

    expect(decisionsOf({ root, command: 'git add -A && git commit -m x' })).toEqual([]);
    expect(decisionsOf({ root, command: 'git add src && git commit -m x' })).toEqual([]);
  });
});

describe('a command that moves HEAD to a commit with other sums asks', () => {
  test.each([
    'git merge topic',
    'git merge --no-edit topic',
    'git cherry-pick topic',
    'git revert topic',
    'git rebase topic',
    'git checkout topic',
    'git switch topic',
    'git reset --hard topic',
    'git reset topic',
    'git checkout topic -- .',
  ])('%s asks', (command) => {
    expect(decisionsOf({ root: withBranches(), command })).toEqual(['ask']);
  });

  test.each([
    'git merge quiet',
    'git cherry-pick quiet',
    'git rebase quiet',
    'git checkout quiet',
    'git switch quiet',
    'git reset --hard quiet',
    'git checkout main',
    'git checkout -b newbranch',
    'git switch -c newbranch',
    'git reset --hard HEAD',
    'git rebase --continue',
    'git merge --abort',
    'git cherry-pick --continue',
    'git revert --abort',
    'git status',
    'git log topic',
    'git diff topic',
  ])('%s passes', (command) => {
    expect(decisionsOf({ root: withBranches(), command })).toEqual([]);
  });

  test('a target that cannot be read asks: a ref that is not there, a range, a mailbox, a pull with nothing fetched', () => {
    const root = withBranches();

    for (const command of [
      'git merge nowhere',
      'git cherry-pick topic~1..topic',
      'git am some.patch',
      'git pull',
      'git rebase nowhere',
    ]) {
      expect(decisionsOf({ root, command }), command).toEqual(['ask']);
    }
  });

  test('a pull reads FETCH_HEAD: sums that differ ask, the same sums pass', () => {
    const root = withBranches();

    git({ root, args: ['fetch', '-q', '.', 'topic'] });
    expect(decisionsOf({ root, command: 'git pull' })).toEqual(['ask']);

    git({ root, args: ['fetch', '-q', '.', 'quiet'] });
    expect(decisionsOf({ root, command: 'git pull' })).toEqual([]);
  });

  test('the change a branch brings is measured from the merge base: a change the current branch made itself is not new', () => {
    const root = withBranches();

    git({ root, args: ['merge', '-q', '--no-edit', 'topic'] });
    git({ root, args: ['checkout', '-q', 'quiet'] });
    git({ root, args: ['merge', '-q', '--no-edit', 'main'] });

    // quiet now holds the new sums; merging main again brings nothing new in.
    expect(decisionsOf({ root, command: 'git merge main' })).toEqual([]);
  });
});

describe('a replaced object does not hide a change', () => {
  test('with the manifest at HEAD replaced by another blob, a commit of the working tree still asks', () => {
    const root = project();
    const original = gitOut({ root, args: ['rev-parse', `HEAD:.agents/vulcan.manifest.json`] });
    const forged = withNewSum(root);

    writeFileSync(manifestPath(root), forged);
    git({ root, args: ['add', '.agents/vulcan.manifest.json'] });

    const blob = gitOut({ root, args: ['rev-parse', ':.agents/vulcan.manifest.json'] });

    // Without the protection, HEAD would read as the forged manifest and the commit would change nothing.
    git({ root, args: ['replace', original, blob] });

    expect(gitOut({ root, args: ['show', 'HEAD:./.agents/vulcan.manifest.json'] })).toBe(
      forged.trim(),
    );
    expect(decisionsOf({ root, command: 'git commit -a -m x' })).toEqual(['ask']);
  });
});

describe('guard-git denies the plumbing through the hook', () => {
  test('git replace is a deny, with or without guard.asks', () => {
    const root = project();
    const answer = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-git.ts')],
      {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, VULCAN_GUARD_ASKS: '' },
        stdin: new Blob([
          `{"tool_name":"Bash","tool_input":{"command":"git replace HEAD HEAD~0"},"cwd":"${root}"}`,
        ]),
      },
    ).stdout.toString();

    expect(answer).toContain('"permissionDecision":"deny"');
    expect(answer).toContain('rewrites an object or a ref by hand');
  });
});
