import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { PackageSwap } from '../../hooks/package-swap.ts';
import { toolEvent } from '../hook-event.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const root = createProject({
  files: {
    'package.json': '{"name":"app"}',
    'evil/package.json': '{"name":"@venizia/vulcan"}',
    'other/package.json': '{"name":"left-pad"}',
    'sub/package.json': '{"name":"sub"}',
    'sub/evil2/package.json': '{"name":"@venizia/vulcan"}',
  },
});

const isDenied = (command: string): boolean =>
  PackageSwap.inspectCommand({ command, cwd: root }).length > 0;

describe('a package manager that takes the guard package from somewhere else is refused', () => {
  test.each([
    'bun add @venizia/vulcan@file:./evil',
    'bun add ./evil',
    'bun add file:./evil',
    'bun add link:./evil',
    'bun add ./missing',
    'bun add @venizia/vulcan@npm:evil@1',
    'bun add @venizia/vulcan@git+https://x.example/a.git',
    'bun add @venizia/vulcan@github:u/r',
    'bun add @venizia/vulcan@https://x.example/a.tgz',
    'bun link @venizia/vulcan',
    'bun patch @venizia/vulcan',
    'bun patch @venizia/vulcan@0.4.10',
    'bun patch node_modules/@venizia/vulcan',
    'bun patch --commit node_modules/@venizia/vulcan',
    'bun patch --commit node_modules/.bun/@venizia+vulcan@1/node_modules/@venizia/vulcan',
    'npm install ./evil',
    'npm i @venizia/vulcan@file:./evil',
    'npm link @venizia/vulcan',
    'npm link ./evil',
    'pnpm add ./evil',
    'pnpm add @venizia/vulcan@link:./evil',
    'pnpm patch @venizia/vulcan',
    'pnpm patch-commit ./evil',
    'yarn add ./evil',
    'yarn add @venizia/vulcan@portal:./evil',
    'yarn link ./evil',
    'sudo bun add ./evil',
    'taskset -c 0 bun add ./evil',
    "su -c 'bun add ./evil'",
  ])('%s is denied', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'npm --loglevel silent install ./evil',
    'npm -D install ./evil',
    'npm --no-audit --foo bar install ./evil',
    'pnpm -r add ./evil',
    'pnpm -w add ./evil',
    'pnpm --filter x add ./evil',
    'pnpm -F x add ./evil',
    'yarn -s add ./evil',
    'bun --silent add ./evil',
  ])('%s is denied: a flag before the verb does not hide it', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'bun --cwd sub add ./evil2',
    'bun add --cwd sub ./evil2',
    'bun --cwd=sub add ./evil2',
    'npm --prefix sub install ./evil2',
    'pnpm -C sub add ./evil2',
    'pnpm --dir sub add ./evil2',
    'yarn --cwd sub add ./evil2',
    'cd sub && bun add ./evil2',
    'cd sub && bun add ../evil',
    'bun --cwd sub add ../evil',
    'cd /nonexistent/$X && bun add ./evil',
  ])('%s is denied: the folder is read where the command runs', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'bun add --registry https://evil.example left-pad',
    'bun install --registry=https://evil.example',
    'bun add --cache-dir /tmp/c left-pad',
    'npm install --registry https://evil.example',
    'pnpm --registry https://evil.example add left-pad',
    'BUN_CONFIG_REGISTRY=https://evil.example bun install',
    'npm_config_registry=https://evil.example npm install',
    'NPM_CONFIG_REGISTRY=https://evil.example pnpm install',
  ])('%s is denied: the source of the install is set on the line', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'bun add @venizia/vulcan@^0.5.0',
    'bun add @venizia/vulcan@next',
    'bun add @venizia/vulcan@0.5.0-0',
    'bun add @venizia/vulcan',
    'bun add -d typescript',
    'bun add left-pad@1.0.1',
    'bun add ./other',
    'bun add github:user/repo',
    'bun add ../x.tgz',
    'cd sub && bun add ../other',
    'bun --cwd sub add ../other',
    'bun install',
    'bun install --frozen-lockfile',
    'bun i',
    'bun remove left-pad',
    'bun update',
    'bun link',
    'bun link left-pad',
    'bun patch left-pad',
    'npm install',
    'npm install @venizia/vulcan@^0.5.0',
    'npm ci',
    'npm pkg set name=x',
    'pnpm install',
    'pnpm add left-pad',
    'pnpm --filter x add left-pad',
    'yarn',
    'yarn add left-pad',
    'bun run build',
    'bun run add ./evil',
    'bun run install ./evil',
    'bunx @venizia/vulcan --version',
    'bun node_modules/.bin/vulcan project sync',
    'git add ./evil',
    'echo bun add ./evil',
  ])('%s passes', (command) => {
    expect(isDenied(command)).toBe(false);
  });
});

describe('the hook refuses the attack that was proven', () => {
  const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-git.ts');
  const answerOf = (command: string): string =>
    spawnSyncBounded({
      cmd: [process.execPath, HOOK],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdin: new Blob([toolEvent({ tool: 'Bash', input: { command }, cwd: root })]),
      stdout: 'pipe',
      stderr: 'pipe',
    }).stdout.toString();

  test('bun add of the package from a folder is denied, with the rule and a way out', () => {
    for (const command of ['bun add @venizia/vulcan@file:./evil', 'bun add ./evil']) {
      const answer = answerOf(command);

      expect(answer, command).toContain('"permissionDecision":"deny"');
      expect(answer, command).toContain('V-S-05');
      expect(answer, command).toContain('registry');
    }
  });

  test('a registry install passes', () => {
    expect(answerOf('bun add @venizia/vulcan@^0.5.0').trim()).toBe('');
    expect(answerOf('bun install').trim()).toBe('');
  });
});
