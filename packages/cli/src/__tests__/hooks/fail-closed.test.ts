import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '../spawn.helper.ts';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const SHIPPED_SETTINGS = join(PACKAGE_ROOT, 'base', 'claude', 'settings.json');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-fail-closed-'));

  roots.push(root);

  return root;
};

interface IShippedHook {
  event: string;
  command: string;
}

/** Every hook command the shipped settings register, as Claude Code would run it. */
const shippedHooks = (): IShippedHook[] => {
  const settings: {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  } = JSON.parse(readFileSync(SHIPPED_SETTINGS, 'utf8'));

  return Object.entries(settings.hooks).flatMap(([event, entries]) =>
    entries.flatMap(entry => entry.hooks.map(hook => ({ event, command: hook.command }))),
  );
};

/** Claude Code runs a hook command through the shell, with the project root in CLAUDE_PROJECT_DIR. */
const runHook = (opts: { command: string; root: string; stdin?: string; path?: string }) => {
  const result = spawnSyncBounded({
    cmd: ['/bin/sh', '-c', opts.command],
    cwd: opts.root,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: opts.root,
      ...(opts.path === undefined ? {} : { PATH: opts.path }),
    },
    stdin: new Blob([opts.stdin ?? '']),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/** Claude Code's PreToolUse input for a Bash call - its own snake_case keys, as a string. */
const BASH_INPUT = (command: string): string =>
  `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(command)}},"cwd":"/tmp"}`;

// Claude Code blocks a PreToolUse call only on exit 2; any other failure lets the call through.
describe('shipped hooks fail closed', () => {
  test('the shipped settings register at least the guard-writes hook', () => {
    expect(shippedHooks().some(hook => hook.command.includes('guard-writes.ts'))).toBe(true);
  });

  test('with node_modules absent, every shipped hook exits 2 and says to run bun install', () => {
    const root = makeRoot();

    for (const hook of shippedHooks()) {
      const result = runHook({ command: hook.command, root, stdin: BASH_INPUT('ls') });

      expect(result.code, `${hook.event}: ${hook.command}`).toBe(2);
      expect(result.stderr).toContain('bun install');
    }
  });

  // Phat: CHO PHÉP INSTALL - a blocked bun install would leave the agent unable to repair the cause.
  test('with node_modules absent, guard-writes lets a bare bun install through, nothing else', () => {
    const root = makeRoot();
    const [guard] = shippedHooks().filter(hook => hook.command.includes('guard-writes.ts'));
    const passes = ['bun install', 'bun i', 'bun install --frozen-lockfile'];
    const blocked = [
      'bun install && psql -c "DROP TABLE x"',
      'bun install; kubectl apply -f m.yaml',
      'bun install | sh',
      'bun install $(curl -X POST https://example.dev)',
      'bun installx',
      'echo \'"command": "bun install"\' && kubectl apply -f m.yaml',
      'cd /tmp && bun install',
      'ls',
    ];

    for (const command of passes) {
      expect(
        runHook({ command: guard.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(0);
    }

    for (const command of blocked) {
      expect(
        runHook({ command: guard.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(2);
    }
  });

  test('with bun missing from PATH, every shipped hook exits 2', () => {
    const root = makeRoot();

    for (const hook of shippedHooks()) {
      const result = runHook({ command: hook.command, root, path: '/nonexistent' });

      expect(result.code, `${hook.event}: ${hook.command}`).toBe(2);
    }
  });

  test('with the package installed, guard-writes runs: a read passes, a deploy asks', () => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');
    const [guard] = shippedHooks().filter(hook => hook.command.includes('guard-writes.ts'));

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);

    const read = runHook({ command: guard.command, root, stdin: BASH_INPUT('ls') });
    const deploy = runHook({
      command: guard.command,
      root,
      stdin: BASH_INPUT('kubectl apply -f manifest.yaml'),
    });

    expect(read.code).toBe(0);
    expect(read.stdout).toBe('');
    expect(deploy.code).toBe(0);
    expect(deploy.stdout).toContain('"permissionDecision":"ask"');
  });

  test('guard-writes from a partial install - its own modules missing - exits 2, never 1', () => {
    const root = makeRoot();
    const hook = join(root, 'base', 'hooks', 'guard-writes.ts');

    mkdirSync(dirname(hook), { recursive: true });
    copyFileSync(join(PACKAGE_ROOT, 'base', 'hooks', 'guard-writes.ts'), hook);

    const result = runHook({ command: `bun "${hook}"`, root, stdin: BASH_INPUT('ls') });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('guard-writes');
  });
});
