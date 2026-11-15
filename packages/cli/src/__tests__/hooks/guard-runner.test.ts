import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { RunnerGuard } from '../../hooks/guard-runner.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const GIT_HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-git.ts');

/** A project whose `node_modules/.bin` holds the given bins. */
const projectWithBins = (opts: { bins: string[]; files?: Record<string, string> }): string => {
  const root = createProject({ files: opts.files ?? {} });

  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });

  for (const bin of opts.bins) {
    writeFileSync(join(root, 'node_modules', '.bin', bin), '#!/bin/sh\n');
  }

  return root;
};

const refusedBy = (opts: { command: string; cwd: string; allow?: string[] }): string[] =>
  RunnerGuard.inspect({ command: opts.command, cwd: opts.cwd, allow: opts.allow ?? [] }).map(
    (hit) => `${hit.rule}:${hit.decision}`,
  );

describe('RunnerGuard: an agent that runs a package by name', () => {
  const root = projectWithBins({ bins: ['vulcan'] });

  test.each([
    'bunx ardor codemod',
    'bun x ardor',
    'bun x --bun ardor',
    'npx ardor',
    'npm exec ardor',
    'pnpm dlx ardor',
    'yarn dlx ardor',
    'bun x --no-install ardor',
    'bun x --no-install=false vulcan',
    'bun x vulcan --no-install',
    'bunx --registry https://r.example.test ardor',
    'bun x -p foo ardor',
    'cd services/api && bunx ardor',
    'echo ok; bunx ardor',
    'sudo bunx ardor',
    'env FOO=1 bunx ardor',
    'FOO=1 bun x ardor',
    "bash -c 'bunx ardor'",
    'x=$(bunx ardor)',
    'bunx "ardor"',
    "bunx 'ardor'",
  ])('denies %s', (command) => {
    expect(refusedBy({ command, cwd: root })).toEqual(['V-S-07:deny']);
  });

  test.each([
    'bun run vulcan sync',
    'bun run ardor',
    './node_modules/.bin/ardor codemod',
    'bun x --no-install vulcan sync',
    'bun x --bun --no-install vulcan sync',
    'bun x @venizia/vulcan@0.4.10 init',
    'bunx @venizia/vulcan init',
    'bun x --package @venizia/ardor ardor codemod',
    'npx @venizia/vulcan init',
    'bun add -d @venizia/vulcan',
    'bun test',
    'git status',
    'echo "never run bunx ardor"',
    'grep -rn "bunx ardor" docs',
    'cat <<EOF\nbunx ardor\nEOF',
    'git commit -m "docs: stop using bunx ardor"',
  ])('allows %s', (command) => {
    expect(refusedBy({ command, cwd: root })).toEqual([]);
  });

  test('--no-install passes only when the bin is linked, here or in a folder above', () => {
    const nested = join(root, 'services', 'api');

    mkdirSync(nested, { recursive: true });

    expect(refusedBy({ command: 'bun x --no-install vulcan sync', cwd: root })).toEqual([]);
    expect(refusedBy({ command: 'bun x --no-install vulcan sync', cwd: nested })).toEqual([]);
    // a bin no folder above holds (the test folder lives inside a checkout that has vulcan and devz linked)
    expect(refusedBy({ command: 'bun x --no-install no-such-bin-xyz sync', cwd: root })).toEqual([
      'V-S-07:deny',
    ]);
  });

  test('a name on the allow-list passes, with a version too', () => {
    expect(refusedBy({ command: 'bunx shadcn@latest add button', cwd: root, allow: ['shadcn'] })).toEqual([]);
    expect(refusedBy({ command: 'bunx shadcn add button', cwd: root, allow: [] })).toEqual(['V-S-07:deny']);
  });

  test('the message names the command and the safe forms', () => {
    const [hit] = RunnerGuard.inspect({ command: 'bunx ardor codemod', cwd: root, allow: [] });

    expect(hit.message).toContain('bunx ardor');
    expect(hit.message).toContain('bun run ardor');
    expect(hit.message).toContain('--no-install');
  });
});

describe('the guard-git hook runs it, for every agent that runs that script', () => {
  const run = (opts: { root: string; command: string; env?: Record<string, string> }) => {
    const child = spawnSyncBounded({
      cmd: [process.execPath, GIT_HOOK],
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, VULCAN_GUARDS: '', ...opts.env },
      stdin: Buffer.from(
        JSON.stringify(
          Object.fromEntries([
            ['tool_name', 'Bash'],
            ['tool_input', { command: opts.command }],
            ['cwd', opts.root],
          ]),
        ),
      ),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  };

  test('denies a bare bunx with V-S-07 and the way out', () => {
    const root = projectWithBins({ bins: [] });
    const out = JSON.parse(run({ root, command: 'bunx ardor codemod' }).stdout);

    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('V-S-07');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('bun run ardor');
  });

  test('says nothing for bun run, and nothing when the guards are off', () => {
    const root = projectWithBins({ bins: [] });

    expect(run({ root, command: 'bun run ardor' }).stdout).toBe('');
    expect(run({ root, command: 'bunx ardor', env: { VULCAN_GUARDS: 'off' } }).stdout).toBe('');
  });

  test("reads the project's allow-list from the manifest", () => {
    const root = projectWithBins({
      bins: [],
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({
          schemaVersion: 1,
          guard: { runners: { allow: ['shadcn'] } },
        }),
      },
    });

    expect(run({ root, command: 'bunx shadcn@latest add button' }).stdout).toBe('');
    expect(run({ root, command: 'bunx turbo run build' }).stdout).toContain('deny');
  });
});
