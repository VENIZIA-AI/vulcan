import { afterAll, describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
    entries.flatMap((entry) => entry.hooks.map((hook) => ({ event, command: hook.command }))),
  );
};

/** The hooks that fail OPEN: the drift guards and the owner-shape hooks, which pass when they cannot run. */
const FAIL_OPEN = [
  'guard-git.ts',
  'guard-scripting.ts',
  'guard-outside.ts',
  'stop.ts',
  'prompt-submit.ts',
  'post-tool.ts',
];
const closedHooks = (): IShippedHook[] =>
  shippedHooks().filter((hook) => !FAIL_OPEN.some((name) => hook.command.includes(name)));
const openHooks = (): IShippedHook[] =>
  shippedHooks().filter((hook) => FAIL_OPEN.some((name) => hook.command.includes(name)));

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
describe('the drift guards fail open', () => {
  test('with node_modules absent or bun missing, every drift guard and shape hook passes the call and says so', () => {
    const root = makeRoot();

    expect(openHooks().length).toBe(7);

    for (const hook of openHooks()) {
      const absent = runHook({ command: hook.command, root, stdin: BASH_INPUT('ls') });
      const noBun = runHook({ command: hook.command, root, path: '/nonexistent' });

      expect(absent.code, hook.command).toBe(0);
      expect(absent.stderr).toMatch(
        /the (call|reply) passes|the prompt goes through|the call is unaffected/,
      );
      expect(noBun.code, hook.command).toBe(0);
    }
  });

  test('with the package installed but a module missing, they pass the call; a safety hook blocks', () => {
    const root = makeRoot();
    // A copy of each hook with no `src` beside it: its import fails.
    const lonely = join(root, 'lonely');

    for (const hook of [
      ...openHooks(),
      ...closedHooks().filter((item) => item.event === 'PreToolUse'),
    ]) {
      const name = /hooks\/([\w-]+)\.ts/.exec(hook.command)?.[1] ?? '';
      const target = join(lonely, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

      mkdirSync(target, { recursive: true });
      copyFileSync(join(PACKAGE_ROOT, 'base', 'hooks', `${name}.ts`), join(target, `${name}.ts`));

      const result = runHook({ command: hook.command, root: lonely, stdin: BASH_INPUT('ls') });
      const open = FAIL_OPEN.includes(`${name}.ts`);

      expect(result.code, name).toBe(open ? 0 : 2);
    }
  });
});

describe('a crashed safety hook', () => {
  test('lets a bare bun install through, so the agent can repair the install, and blocks anything else', () => {
    const lonely = makeRoot();
    const target = join(lonely, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');
    const [guard] = shippedHooks().filter((hook) => hook.command.includes('guard-writes.ts'));

    mkdirSync(target, { recursive: true });
    copyFileSync(
      join(PACKAGE_ROOT, 'base', 'hooks', 'guard-writes.ts'),
      join(target, 'guard-writes.ts'),
    );

    expect(
      runHook({ command: guard.command, root: lonely, stdin: BASH_INPUT('bun install') }).code,
    ).toBe(0);
    expect(
      runHook({
        command: guard.command,
        root: lonely,
        stdin: BASH_INPUT('bun install --frozen-lockfile'),
      }).code,
    ).toBe(0);
    expect(runHook({ command: guard.command, root: lonely, stdin: BASH_INPUT('ls') }).code).toBe(2);
    expect(
      runHook({ command: guard.command, root: lonely, stdin: BASH_INPUT('bun install && ls') })
        .code,
    ).toBe(2);
  });
});

describe('shipped hooks fail closed', () => {
  test('the shipped settings register at least the guard-writes hook', () => {
    expect(shippedHooks().some((hook) => hook.command.includes('guard-writes.ts'))).toBe(true);
  });

  test('with node_modules absent, every shipped hook exits 2 and says to run bun install', () => {
    const root = makeRoot();

    for (const hook of closedHooks()) {
      const result = runHook({ command: hook.command, root, stdin: BASH_INPUT('ls') });

      expect(result.code, `${hook.event}: ${hook.command}`).toBe(2);
      expect(result.stderr).toContain('node_modules/@venizia/vulcan is missing - run bun install');
      expect(result.stderr).not.toContain('bun is not on PATH');
    }
  });

  // Phat: CHO PHÉP INSTALL - a blocked bun install would leave the agent unable to repair the cause.
  test('with node_modules absent, guard-writes lets a bare bun install through, nothing else', () => {
    const root = makeRoot();
    const [guard] = shippedHooks().filter((hook) => hook.command.includes('guard-writes.ts'));
    const passes = [
      'bun install',
      'bun i',
      'bun install --frozen-lockfile',
      'bun i --production',
      'bun install -p --no-save',
    ];
    const blocked = [
      'bun install && psql -c "DROP TABLE x"',
      'bun install; kubectl apply -f m.yaml',
      'bun install | sh',
      'bun install $(curl -X POST https://example.dev)',
      'bun installx',
      'echo \'"command": "bun install"\' && kubectl apply -f m.yaml',
      'cd /tmp && bun install',
      'bun install --cwd=..',
      'bun install --cwd ..',
      'bun install --config=evil.toml',
      'bun install --global',
      'bun install left-pad',
      'bun install --frozen-lockfile=false',
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

    for (const hook of closedHooks()) {
      const result = runHook({ command: hook.command, root, path: '/nonexistent' });

      expect(result.code, `${hook.event}: ${hook.command}`).toBe(2);
    }
  });

  test('with the package installed but bun missing from PATH, the message names PATH, not bun install', () => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);

    for (const hook of closedHooks()) {
      const result = runHook({
        command: hook.command,
        root,
        stdin: BASH_INPUT('ls'),
        path: '/nonexistent',
      });

      expect(result.code, `${hook.event}: ${hook.command}`).toBe(2);
      expect(result.stderr).toContain(
        "bun is not on PATH - put bun on PATH (Claude Code may have started without your shell's PATH)",
      );
      expect(result.stderr).not.toContain('is missing');
    }
  });

  test('with the package installed, guard-writes runs: a read passes, a deploy asks', () => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');
    const [guard] = shippedHooks().filter((hook) => hook.command.includes('guard-writes.ts'));

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

  test('bun itself failing before the hook runs (a broken bunfig.toml) still blocks', () => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');
    const [guard] = shippedHooks().filter((hook) => hook.command.includes('guard-writes.ts'));

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);
    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./missing-preload.ts"]\n');

    const result = runHook({
      command: guard.command,
      root,
      stdin: BASH_INPUT('kubectl apply -f m.yaml'),
    });

    expect(result.code).toBe(2);
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
