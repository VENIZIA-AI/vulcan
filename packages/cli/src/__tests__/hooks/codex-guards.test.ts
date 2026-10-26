import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mergeCodexHooks } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT = join(PACKAGE_ROOT, 'base', 'hooks', 'codex-guards.ts');

/** A project with the package installed, so the real guard scripts run. */
const installedProject = (): string => {
  const root = createProject({ files: { 'package.json': '{}' } });
  const installed = join(root, 'node_modules', '@venizia', 'vulcan');

  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync(PACKAGE_ROOT, installed);

  return root;
};

/** Codex's PreToolUse event: snake_case, the shell is `Bash`, a patch is `apply_patch` with its text in `command`. */
const eventOf = (opts: { root: string; tool: string; command: string }): string =>
  JSON.stringify(
    Object.fromEntries([
      ['session_id', 's'],
      ['cwd', opts.root],
      ['hook_event_name', 'PreToolUse'],
      ['tool_name', opts.tool],
      ['tool_input', { command: opts.command }],
    ]),
  );

const run = (opts: { root: string; stdin: string; env?: Record<string, string> }) => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, SCRIPT],
    cwd: opts.root,
    env: { ...process.env, ...opts.env },
    stdin: new Blob([opts.stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const text = result.stdout.toString().trim();

  return {
    code: result.exitCode,
    text,
    output: text === '' ? undefined : JSON.parse(text),
  };
};

const decisionOf = (output: unknown): string | undefined => {
  if (typeof output !== 'object' || output === null || !('hookSpecificOutput' in output)) {
    return undefined;
  }

  const specific = output.hookSpecificOutput;

  return typeof specific === 'object' &&
    specific !== null &&
    'permissionDecision' in specific &&
    typeof specific.permissionDecision === 'string'
    ? specific.permissionDecision
    : undefined;
};

describe('the Codex hook command runs the real guards', () => {
  test('a force-push to main is denied with the guard reason; a status prints nothing', () => {
    const root = installedProject();
    const push = run({
      root,
      stdin: eventOf({ root, tool: 'Bash', command: 'git push -f origin main' }),
    });

    expect(push.code).toBe(0);
    expect(decisionOf(push.output)).toBe('deny');
    expect(push.text).toContain("force-pushing to 'main'");
    expect(run({ root, stdin: eventOf({ root, tool: 'Bash', command: 'git status' }) }).text).toBe(
      '',
    );
  });

  test('Codex cannot ask, so an ask is printed as a deny that says a human must confirm', () => {
    const root = installedProject();
    const deploy = run({
      root,
      stdin: eventOf({ root, tool: 'Bash', command: 'kubectl apply -f deploy.yaml' }),
    });

    expect(decisionOf(deploy.output)).toBe('deny');
    expect(deploy.text).toContain('V-W-03');
    expect(deploy.text).toContain('Codex cannot ask about a tool call');
  });

  test('an apply_patch is read file by file: the manifest and a path outside the project are refused', () => {
    const root = installedProject();
    const patch = (lines: string[]): string =>
      ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
    const manifest = run({
      root,
      stdin: eventOf({
        root,
        tool: 'apply_patch',
        command: patch(['*** Update File: .agents/vulcan.manifest.json', '@@', '-a', '+b']),
      }),
    });
    const outside = run({
      root,
      stdin: eventOf({
        root,
        tool: 'apply_patch',
        command: patch(['*** Add File: /var/tmp/vulcan-guard-probe-never-created', '+x']),
      }),
    });
    const inside = run({
      root,
      stdin: eventOf({
        root,
        tool: 'apply_patch',
        command: patch(['*** Add File: docs/new.md', '+x']),
      }),
    });

    expect(decisionOf(manifest.output)).toBe('deny');
    expect(decisionOf(outside.output)).toBe('deny');
    expect(outside.text).toContain('V-B-08');
    expect(inside.text).toBe('');
  });

  test('another tool, unreadable input and VULCAN_GUARDS=off print nothing', () => {
    const root = installedProject();
    const push = eventOf({ root, tool: 'Bash', command: 'git push -f origin main' });

    expect(run({ root, stdin: eventOf({ root, tool: 'WebSearch', command: 'x' }) }).text).toBe('');
    expect(run({ root, stdin: 'not json' }).text).toBe('');
    expect(run({ root, stdin: '' }).text).toBe('');
    expect(run({ root, stdin: push, env: { VULCAN_GUARDS: 'off' } }).text).toBe('');
  });
});

describe('the hook command wrapper in .codex/hooks.json', () => {
  /** The command sync writes, as Codex runs it: a shell command from the project, with no git above it. */
  const commandOf = (): string => {
    const merged = mergeCodexHooks({ text: undefined });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const file: { hooks: { PreToolUse: { hooks: { command: string }[] }[] } } = JSON.parse(
      merged.text,
    );

    return file.hooks.PreToolUse[0]?.hooks[0]?.command ?? '';
  };

  const runWrapper = (opts: { root: string; stdin: string }) => {
    const result = spawnSyncBounded({
      cmd: ['/bin/sh', '-c', commandOf()],
      cwd: opts.root,
      // No git repository above the project, so the project is the working directory.
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(opts.root) },
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
    const result = runWrapper({
      root,
      stdin: eventOf({ root, tool: 'Bash', command: 'git push -f origin main' }),
    });

    expect(result.code).toBe(0);
    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
  });

  test('with no package it prints nothing, says so on stderr and exits 0', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const result = runWrapper({ root, stdin: eventOf({ root, tool: 'Bash', command: 'ls' }) });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('the guards cannot run');
  });

  test('an adapter that started and crashed is a deny, because Codex cannot ask', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const hooks = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'codex-guards.ts'), 'process.exit(3);\n');

    const result = runWrapper({ root, stdin: eventOf({ root, tool: 'Bash', command: 'ls' }) });

    expect(result.code).toBe(0);
    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
    expect(result.stdout).toContain('The VULCAN guard crashed');
  });
});
