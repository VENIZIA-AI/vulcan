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
