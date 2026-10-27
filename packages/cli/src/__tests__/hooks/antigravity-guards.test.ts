import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GUARD_HOOK_NAME, mergeGuardHook } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT = join(PACKAGE_ROOT, 'base', 'hooks', 'antigravity-guards.ts');

/** A project with the package installed, so the real guard scripts run. */
const installedProject = (): string => {
  const root = createProject({ files: { 'package.json': '{}' } });
  const installed = join(root, 'node_modules', '@venizia', 'vulcan');

  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync(PACKAGE_ROOT, installed);

  return root;
};

/** Antigravity's PreToolUse event: camelCase, the tool in `toolCall`, no cwd of its own. */
const eventOf = (opts: { root: string; name: string; args: Record<string, unknown> }): string =>
  JSON.stringify({
    conversationId: 'c',
    stepIdx: 2,
    toolCall: { name: opts.name, args: opts.args },
    workspacePaths: [opts.root],
  });

const run = (opts: { stdin: string; root: string; env?: Record<string, string> }) => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, SCRIPT],
    cwd: opts.root,
    env: { ...process.env, ...opts.env },
    stdin: new Blob([opts.stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: result.exitCode,
    answer: JSON.parse(result.stdout.toString().trim() || '{}') as {
      decision?: string;
      reason?: string;
    },
  };
};

const command = (opts: { root: string; text: string }) =>
  run({
    root: opts.root,
    stdin: eventOf({ root: opts.root, name: 'run_command', args: { CommandLine: opts.text } }),
  });

describe('the Antigravity hook command runs the real guards', () => {
  test('a force-push to main is denied with the guard reason; a status is allowed', () => {
    const root = installedProject();
    const push = command({ root, text: 'git push -f origin main' });

    expect(push.code).toBe(0);
    expect(push.answer.decision).toBe('deny');
    expect(push.answer.reason).toContain("force-pushing to 'main'");
    expect(command({ root, text: 'git status --short' }).answer).toEqual({ decision: 'allow' });
  });

  test('a write outside the project and a deploy are asked about', () => {
    const root = installedProject();
    const outside = command({ root, text: 'touch /var/tmp/vulcan-guard-probe-never-created' });
    const deploy = command({ root, text: 'kubectl apply -f deploy.yaml' });

    expect(outside.answer.decision).toBe('ask');
    expect(outside.answer.reason).toContain('V-B-08');
    expect(deploy.answer.decision).toBe('ask');
    expect(deploy.answer.reason).toContain('V-W-03');
  });

  test('the file tools are mapped: a write onto the manifest is denied', () => {
    const root = installedProject();
    const target = join(root, '.agents', 'vulcan.manifest.json');

    for (const name of ['write_to_file', 'replace_file_content', 'multi_replace_file_content']) {
      const result = run({
        root,
        stdin: eventOf({ root, name, args: { TargetFile: target } }),
      });

      expect(result.answer.decision, name).toBe('deny');
    }
  });

  test('a tool no guard covers, unreadable input and VULCAN_GUARDS=off are allowed', () => {
    const root = installedProject();
    const push = eventOf({
      root,
      name: 'run_command',
      args: { CommandLine: 'git push -f origin main' },
    });

    expect(
      run({
        root,
        stdin: eventOf({ root, name: 'view_file', args: { AbsolutePath: '/etc/passwd' } }),
      }).answer,
    ).toEqual({ decision: 'allow' });
    expect(run({ root, stdin: 'not json' }).answer).toEqual({ decision: 'allow' });
    expect(run({ root, stdin: '' }).answer).toEqual({ decision: 'allow' });
    expect(run({ root, stdin: push, env: { VULCAN_GUARDS: 'off' } }).answer).toEqual({
      decision: 'allow',
    });
  });

  test('the command comes from the CommandLine; the Cwd of the call is where the guards look for the install', () => {
    const root = installedProject();
    const sub = join(root, 'src');

    mkdirSync(sub, { recursive: true });

    const result = run({
      root,
      stdin: eventOf({
        root,
        name: 'run_command',
        args: { CommandLine: 'git push -f origin main', Cwd: sub },
      }),
    });

    expect(result.answer.decision).toBe('deny');
  });
});

describe('the hook command wrapper in .agents/hooks.json', () => {
  /** The command sync writes, as Antigravity runs it: a shell command, with the folder of the hooks file as cwd. */
  const commandOf = (): string => {
    const merged = mergeGuardHook({ text: undefined });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const parsed: Record<
      string,
      { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    > = JSON.parse(merged.text);

    return parsed[GUARD_HOOK_NAME]?.PreToolUse[0]?.hooks[0]?.command ?? '';
  };

  const runWrapper = (opts: { root: string; stdin: string }) => {
    mkdirSync(join(opts.root, '.agents'), { recursive: true });

    const result = spawnSyncBounded({
      cmd: ['/bin/sh', '-c', commandOf()],
      cwd: join(opts.root, '.agents'),
      env: { ...process.env },
      stdin: new Blob([opts.stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return {
      code: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString(),
    };
  };

  test('with the package installed it forwards the answer of the adapter', () => {
    const root = installedProject();
    const stdin = eventOf({
      root,
      name: 'run_command',
      args: { CommandLine: 'git push -f origin main' },
    });
    const result = runWrapper({ root, stdin });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).decision).toBe('deny');
  });

  test('with no package it allows, says so on stderr, and exits 0', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const result = runWrapper({ root, stdin: eventOf({ root, name: 'run_command', args: {} }) });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ decision: 'allow' });
    expect(result.stderr).toContain('the guards cannot run');
  });

  test('an adapter that started and crashed asks, as the Claude wrappers do', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const hooks = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'antigravity-guards.ts'), 'process.exit(3);\n');

    const result = runWrapper({ root, stdin: eventOf({ root, name: 'run_command', args: {} }) });
    const answer = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(answer.decision).toBe('ask');
    expect(answer.reason).toContain('The VULCAN guard crashed');
  });
});
