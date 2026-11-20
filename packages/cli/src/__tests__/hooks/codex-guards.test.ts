import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CodexHooks } from '../../agents/index.ts';
import { installBundle } from '../bundle.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { GUARD_MANIFEST_FILE, guardManifest } from '../guard-manifest.helper.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT = join(PACKAGE_ROOT, 'base', 'hooks', 'codex-guards.ts');

const DENY_OUTSIDE_CONFIG =
  "export default { rules: { 'V-W-01': 'on-user-word' }, guard: { outside: 'deny' } };\n";
/** What `vulcan sync` renders from it: the hooks read this, not the config. */
const DENY_OUTSIDE_MANIFEST = guardManifest({ guard: { outside: 'deny' } });

/** A project with the hook bundle copied in, as `vulcan sync` leaves it, so the real guards run. */
const installedProject = (opts: { files?: Record<string, string> } = {}): string => {
  const root = createProject({ files: { 'package.json': '{}', ...opts.files } });

  installBundle({ root });

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

  test('a package run by name is denied with V-S-08 (the git guard script runs the runner check too); bun run is not', () => {
    const root = installedProject();
    const bunx = run({
      root,
      stdin: eventOf({ root, tool: 'Bash', command: 'bunx ardor codemod' }),
    });

    expect(decisionOf(bunx.output)).toBe('deny');
    expect(bunx.text).toContain('V-S-08');
    expect(bunx.text).toContain('bun node_modules/.bin/ardor');
    expect(
      run({ root, stdin: eventOf({ root, tool: 'Bash', command: 'bun run ardor' }) }).text,
    ).toBe('');
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

  test('with guard.outside set to deny, a write outside the project is a real deny, not an ask turned into one', () => {
    const root = installedProject({
      files: {
        '.configs/vulcan.config.mts': DENY_OUTSIDE_CONFIG,
        [GUARD_MANIFEST_FILE]: DENY_OUTSIDE_MANIFEST,
      },
    });
    const outside = run({
      root,
      stdin: eventOf({
        root,
        tool: 'Bash',
        command: 'echo x > /var/tmp/vulcan-guard-probe-never-created',
      }),
    });

    expect(decisionOf(outside.output)).toBe('deny');
    expect(outside.text).toContain('guard.outside');
    expect(outside.text).not.toContain('Codex cannot ask about a tool call');
  });

  test('an apply_patch is read file by file: a path outside the project is refused', () => {
    const root = installedProject();
    const patch = (lines: string[]): string =>
      ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
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
    const merged = CodexHooks.merge({ text: undefined });

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

  test('a .env and a bunfig.toml in the project do not reach the adapter', () => {
    const root = installedProject({
      files: {
        ...{
          '.env': 'VULCAN_GUARDS=off\n',
          'evil.ts': 'process.exit(0);\n',
          'bunfig.toml': 'preload = ["./evil.ts"]\n',
        },
        [GUARD_MANIFEST_FILE]: guardManifest({ guard: { asks: 'deny' } }),
      },
    });
    const result = runWrapper({
      root,
      stdin: eventOf({ root, tool: 'Bash', command: 'git reset --hard HEAD~1' }),
    });

    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
    expect(result.stdout).toContain('guard.asks');
  });

  test('with the package installed it forwards the answer of the adapter', () => {
    const root = installedProject();
    const result = runWrapper({
      root,
      stdin: eventOf({ root, tool: 'Bash', command: 'git push -f origin main' }),
    });

    expect(result.code).toBe(0);
    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
  });

  test('with no bundle it denies, says so on stderr and names who repairs it: Codex cannot ask, and a fresh clone is not left unguarded', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const result = runWrapper({ root, stdin: eventOf({ root, tool: 'Bash', command: 'ls' }) });

    expect(result.code).toBe(0);
    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
    expect(result.stdout).toContain('the owner runs bun node_modules/.bin/vulcan sync');
    expect(result.stderr).toContain('the guards cannot run');
  });

  test('a bundle that is not the one the manifest at HEAD records denies', () => {
    const root = installedProject();
    const file = join(root, '.agents', 'local', 'hooks', 'codex-guards.js');

    chmodSync(file, 0o644);
    writeFileSync(file, 'process.exit(0);\n');

    const result = runWrapper({ root, stdin: eventOf({ root, tool: 'Bash', command: 'ls' }) });

    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
    expect(result.stderr).toContain('the manifest at HEAD');
  });

  test('an adapter that started and crashed is a deny, because Codex cannot ask', () => {
    const root = createProject({ files: { 'package.json': '{}' } });

    installBundle({ root, bare: true, files: { 'codex-guards.js': 'process.exit(3);\n' } });

    const result = runWrapper({ root, stdin: eventOf({ root, tool: 'Bash', command: 'ls' }) });

    expect(result.code).toBe(0);
    expect(decisionOf(JSON.parse(result.stdout))).toBe('deny');
    expect(result.stdout).toContain('The VULCAN guard crashed');
  });
});
