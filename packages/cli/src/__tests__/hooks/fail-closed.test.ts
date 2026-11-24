import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { toolEvent } from '../hook-event.helper.ts';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const SHIPPED_SETTINGS = join(PACKAGE_ROOT, 'base', 'claude', 'settings.json');

// Every test here starts bun processes (a hook, twice in some): its time is the machine's load, not a property
// of the hooks. The default of 5 s was reached on a loaded run of the whole suite, so this file allows 60 s. A hook
// that hangs still fails: `spawnSyncBounded` kills a spawn after 120 s and throws, a sync spawn being the one wait
// the test timeout cannot cut short.
setDefaultTimeout(60_000);

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

/** Every hook command of a settings file, as Claude Code would run it. */
const hooksOf = (path: string): IShippedHook[] => {
  const settings: {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  } = JSON.parse(readFileSync(path, 'utf8'));

  return Object.entries(settings.hooks).flatMap(([event, entries]) =>
    entries.flatMap((entry) => entry.hooks.map((hook) => ({ event, command: hook.command }))),
  );
};

/** Every hook command the shipped settings register. */
const shippedHooks = (): IShippedHook[] => hooksOf(SHIPPED_SETTINGS);

/** The guards that ask when a hook started and then failed: a missing package, bun or hook blocks them too (guard-git on a git or gh line). */
const ASKING = ['guard-git.ts', 'guard-outside.ts'];
const closedHooks = (): IShippedHook[] =>
  shippedHooks().filter((hook) => !ASKING.some((name) => hook.command.includes(name)));
const askingHooks = (): IShippedHook[] =>
  shippedHooks().filter((hook) => ASKING.some((name) => hook.command.includes(name)));

/** Claude Code runs a hook command through the shell, with the project root in CLAUDE_PROJECT_DIR. */
const runHook = (opts: {
  command: string;
  root: string;
  stdin?: string;
  path?: string;
  env?: Record<string, string>;
  /** The host does not set CLAUDE_PROJECT_DIR at all; the hook still runs from the project root. */
  unsetProjectDir?: boolean;
}) => {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_PROJECT_DIR: opts.root,
    ...(opts.path === undefined ? {} : { PATH: opts.path }),
    ...opts.env,
  };

  if (opts.unsetProjectDir === true) {
    delete environment.CLAUDE_PROJECT_DIR;
  }

  const result = spawnSyncBounded({
    cmd: ['/bin/sh', '-c', opts.command],
    cwd: opts.root,
    env: environment,
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

/** A PATH with bun taken out and the tools a wrapper uses (cat, grep, timeout) kept. */
const pathWithoutBun = (): string => {
  const directory = join(makeRoot(), 'tools');

  mkdirSync(directory, { recursive: true });

  for (const tool of ['cat', 'grep', 'timeout']) {
    const found = Bun.which(tool);

    if (found !== null) {
      symlinkSync(found, join(directory, tool));
    }
  }

  return directory;
};

/** Claude Code's PreToolUse input for a Bash call - its own snake_case keys, as a string. */
const BASH_INPUT = (command: string): string =>
  `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(command)}},"cwd":"/tmp"}`;

// Claude Code blocks a PreToolUse call only on exit 2; any other failure lets the call through.
describe('the guards that ask on a crash fail closed when the package or bun is missing', () => {
  const GIT_CALLS = ['git status', 'gh pr list', 'cd x && git push'];
  const REPAIRS = [
    'bun install',
    'bun i --frozen-lockfile',
    'bun node_modules/.bin/vulcan project sync',
    'bun node_modules/.bin/vulcan project sync --app apps/web',
  ];
  const NOT_REPAIRS = [
    'bun install && git push',
    'bun node_modules/.bin/vulcan project sync; git push',
    'bun node_modules/.bin/vulcan project sync $(git push)',
    'bun node_modules/.bin/vulcan project sync | git apply',
  ];

  const [git] = askingHooks().filter((hook) => hook.command.includes('guard-git.ts'));
  const [outside] = askingHooks().filter((hook) => hook.command.includes('guard-outside.ts'));

  test.each([
    ['node_modules absent', undefined],
    ['bun missing from PATH', 'no-bun'],
  ])('%s: guard-outside blocks every call, guard-git a git or gh line', (_, mode) => {
    const root = makeRoot();
    const path = mode === undefined ? undefined : pathWithoutBun();

    // With bun missing the package is there: only bun is what the wrapper cannot find.
    if (mode !== undefined) {
      const installed = join(root, 'node_modules', '@venizia', 'vulcan');

      mkdirSync(dirname(installed), { recursive: true });
      symlinkSync(PACKAGE_ROOT, installed);
    }

    expect(askingHooks().length).toBe(2);

    for (const command of ['ls', ...GIT_CALLS]) {
      const result = runHook({ command: outside.command, root, path, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(2);
      expect(result.stderr, command).toContain('VULCAN guards unavailable');
    }

    for (const command of GIT_CALLS) {
      const result = runHook({ command: git.command, root, path, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(2);
      expect(result.stderr, command).toContain('VULCAN guards unavailable');
    }

    for (const command of ['ls', 'echo digit', 'bun test']) {
      const result = runHook({ command: git.command, root, path, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(0);
      expect(result.stderr, command).toContain('names no git or gh');
    }
  });

  test('a call that names no command at all is blocked by guard-outside and passed by guard-git', () => {
    const root = makeRoot();

    expect(runHook({ command: outside.command, root, stdin: '' }).code).toBe(2);
    expect(runHook({ command: git.command, root, stdin: '' }).code).toBe(0);
  });

  test('the repair commands pass while the install is missing, and nothing that only starts with one does', () => {
    const root = makeRoot();

    for (const command of REPAIRS) {
      expect(
        runHook({ command: outside.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(0);
      expect(
        runHook({ command: git.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(0);
    }

    for (const command of NOT_REPAIRS) {
      expect(
        runHook({ command: outside.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(2);
      expect(
        runHook({ command: git.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(2);
    }
  });

  test('with the package installed but a module missing, they ask; a safety hook blocks', () => {
    const root = makeRoot();
    // A copy of each hook with no `src` beside it: its import fails.
    const lonely = join(root, 'lonely');

    for (const hook of [
      ...askingHooks(),
      ...closedHooks().filter((item) => item.event === 'PreToolUse'),
    ]) {
      const name = /hooks\/([\w-]+)\.ts/.exec(hook.command)?.[1] ?? '';
      const target = join(lonely, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

      mkdirSync(target, { recursive: true });
      copyFileSync(join(PACKAGE_ROOT, 'base', 'hooks', `${name}.ts`), join(target, `${name}.ts`));

      const result = runHook({
        command: hook.command,
        root: lonely,
        stdin: BASH_INPUT('git status'),
      });
      const asks = ASKING.includes(`${name}.ts`);

      expect(result.code, name).toBe(asks ? 0 : 2);

      if (asks) {
        expect(result.stdout, name).toContain('"permissionDecision":"ask"');
      }
    }
  });
});

describe('a hook that is gone from an installed package', () => {
  const nameOf = (hook: IShippedHook): string =>
    /hooks\/([\w-]+)\.ts/.exec(hook.command)?.[1] ?? '';

  /** A project with `node_modules/@venizia/vulcan` present, `package.json` or not, and no hook file in it. */
  const rootWithoutHooks = (opts: { withPackageJson: boolean }): string => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');

    mkdirSync(join(installed, 'base', 'hooks'), { recursive: true });

    if (opts.withPackageJson) {
      writeFileSync(join(installed, 'package.json'), '{}');
    }

    return root;
  };

  test.each(closedHooks().map((hook) => ({ name: nameOf(hook), hook })))(
    'passes with a true note, whatever the call: $name',
    ({ name, hook }) => {
      const root = rootWithoutHooks({ withPackageJson: true });

      for (const command of ['ls', 'bun install && ls']) {
        const result = runHook({ command: hook.command, root, stdin: BASH_INPUT(command) });

        expect(result.code, command).toBe(0);
        expect(result.stderr).toContain(
          `the ${name} hook is not in this node_modules/@venizia/vulcan`,
        );
        expect(result.stderr).toContain('vulcan project sync');
      }
    },
  );

  test('guard-outside blocks and guard-git blocks a git or gh line when the package is there and the hook is not', () => {
    const root = rootWithoutHooks({ withPackageJson: true });
    const [git] = askingHooks().filter((hook) => hook.command.includes('guard-git.ts'));
    const [outside] = askingHooks().filter((hook) => hook.command.includes('guard-outside.ts'));

    for (const command of ['ls', 'git status']) {
      const result = runHook({ command: outside.command, root, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(2);
      expect(result.stderr).toContain('VULCAN guards unavailable');
      expect(result.stderr).toContain('vulcan project sync');
    }

    expect(runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).code).toBe(2);
    expect(runHook({ command: git.command, root, stdin: BASH_INPUT('ls') }).code).toBe(0);

    for (const command of ['bun install', 'bun node_modules/.bin/vulcan project sync']) {
      expect(
        runHook({ command: outside.command, root, stdin: BASH_INPUT(command) }).code,
        command,
      ).toBe(0);
    }
  });

  test.each(closedHooks().map((hook) => ({ name: nameOf(hook), hook })))(
    'still blocks when the package itself is missing: $name',
    ({ name, hook }) => {
      const absent = makeRoot();
      const hollow = rootWithoutHooks({ withPackageJson: false });

      for (const root of [absent, hollow]) {
        const result = runHook({ command: hook.command, root, stdin: BASH_INPUT('ls') });

        expect(result.code, name).toBe(2);
        expect(result.stderr, name).toContain('is missing - run bun install');
      }
    },
  );
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

describe('the deny-class guards ask when the hook starts and then fails', () => {
  const ASK = '"permissionDecision":"ask"';
  const [git] = askingHooks().filter((hook) => hook.command.includes('guard-git.ts'));
  const [outside] = askingHooks().filter((hook) => hook.command.includes('guard-outside.ts'));

  /** A project whose installed hook is `script`, with no `src` beside it. */
  const rootWithHook = (opts: { name: string; script: string }): string => {
    const root = makeRoot();
    const target = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, `${opts.name}.ts`), opts.script);

    return root;
  };

  test.each([
    ['exits non-zero', 'process.exit(3);'],
    ['is killed', "process.kill(process.pid, 'SIGKILL');"],
    ['throws at load', "throw new Error('boom');"],
  ])(
    'a hook that %s: guard-git asks about a git or gh command and passes the rest',
    (_, script) => {
      const root = rootWithHook({ name: 'guard-git', script });

      for (const command of ['git status', 'cd x && gh pr list', 'sudo git push']) {
        const result = runHook({ command: git.command, root, stdin: BASH_INPUT(command) });

        expect(result.code, command).toBe(0);
        expect(result.stdout, command).toContain(ASK);
        expect(result.stdout).toContain('The guard-git hook crashed or timed out');
      }

      for (const command of ['ls', 'echo digit', 'bun test']) {
        const result = runHook({ command: git.command, root, stdin: BASH_INPUT(command) });

        expect(result.code, command).toBe(0);
        expect(result.stdout, command).toBe('');
        expect(result.stderr).toContain('the guard-git hook failed - the call passes');
      }
    },
  );

  test.each([
    ['exits non-zero', 'process.exit(3);'],
    ['is killed', "process.kill(process.pid, 'SIGKILL');"],
  ])('a hook that %s: guard-outside asks about every call', (_, script) => {
    const root = rootWithHook({ name: 'guard-outside', script });
    const result = runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(ASK);
    expect(result.stdout).toContain('The guard-outside hook crashed or timed out');
  });

  test('a timeout (exit 124 of timeout(1)) asks the same way', () => {
    const root = rootWithHook({ name: 'guard-git', script: 'process.exit(0);' });
    const fake = join(root, 'fake-bin');

    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, 'timeout'), '#!/bin/sh\nexit 124\n');
    chmodSync(join(fake, 'timeout'), 0o755);

    const result = runHook({
      command: git.command,
      root,
      stdin: BASH_INPUT('git status'),
      path: `${fake}:${process.env.PATH ?? ''}`,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(ASK);
  });

  test('a hook that finishes is forwarded as it is: silence stays silence, a decision stays a decision', () => {
    const silent = rootWithHook({ name: 'guard-git', script: 'process.exit(0);' });
    const loud = rootWithHook({ name: 'guard-git', script: 'console.log(\'{"x":1}\');' });

    expect(
      runHook({ command: git.command, root: silent, stdin: BASH_INPUT('git status') }),
    ).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(
      runHook({ command: git.command, root: loud, stdin: BASH_INPUT('git status') }).stdout,
    ).toBe('{"x":1}');
  });

  test('with the package unloadable (its modules missing), a git command asks and ls passes', () => {
    const root = makeRoot();
    const target = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(target, { recursive: true });
    copyFileSync(join(PACKAGE_ROOT, 'base', 'hooks', 'guard-git.ts'), join(target, 'guard-git.ts'));
    copyFileSync(
      join(PACKAGE_ROOT, 'base', 'hooks', 'guard-outside.ts'),
      join(target, 'guard-outside.ts'),
    );

    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout,
    ).toContain(ASK);
    expect(runHook({ command: git.command, root, stdin: BASH_INPUT('ls') }).stdout).toBe('');
    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).stdout).toContain(
      ASK,
    );
  });

  test('VULCAN_GUARDS=off is silent through the wrapper, and the working package still decides', () => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);

    const push = BASH_INPUT('git push -f origin main');

    expect(
      runHook({ command: git.command, root, stdin: push, env: { VULCAN_GUARDS: 'off' } }),
    ).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(runHook({ command: git.command, root, stdin: push }).stdout).toContain(
      '"permissionDecision":"deny"',
    );
    expect(runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout).toBe(
      '',
    );
  });
});

// Copilot and Cursor read `.claude/settings.json` too and may not set CLAUDE_PROJECT_DIR: a wrapper that
// built its path from the bare variable looked in `/node_modules`, found nothing and exited 2.
describe('guard.asks: deny turns the answer of a crashed hook into a deny', () => {
  const DENY = '"permissionDecision":"deny"';
  const [git] = askingHooks().filter((hook) => hook.command.includes('guard-git.ts'));
  const [outside] = askingHooks().filter((hook) => hook.command.includes('guard-outside.ts'));

  const rootWithManifest = (opts: { manifest: string; script?: string }): string => {
    const root = makeRoot();
    const target = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(target, { recursive: true });
    mkdirSync(join(root, '.agents', 'local'), { recursive: true });
    writeFileSync(join(root, '.agents', 'local', 'vulcan.manifest.json'), opts.manifest);

    for (const name of ['guard-git', 'guard-outside']) {
      if (opts.script === undefined) {
        // A hook with no `src` beside it: its own import fails and its catch answers.
        copyFileSync(join(PACKAGE_ROOT, 'base', 'hooks', `${name}.ts`), join(target, `${name}.ts`));
      } else {
        writeFileSync(join(target, `${name}.ts`), opts.script);
      }
    }

    return root;
  };

  test.each([
    ['the wrapper sees the hook exit non-zero', 'process.exit(3);'],
    ['the hook throws at load', "throw new Error('boom');"],
  ])('%s: both guards deny', (_, script) => {
    const root = rootWithManifest({ manifest: '{"guard":{"asks":"deny"}}', script });

    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout,
    ).toContain(DENY);
    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).stdout).toContain(
      DENY,
    );
    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout,
    ).toContain('guard.asks');
  });

  test('a hook whose import fails answers with its own catch, and that answer is a deny too', () => {
    const root = rootWithManifest({ manifest: '{"guard":{"asks":"deny"}}' });

    for (const [hook, command] of [
      [git, 'git status'],
      [outside, 'ls'],
    ] as const) {
      const result = runHook({ command: hook.command, root, stdin: BASH_INPUT(command) });

      expect(result.stdout, command).toContain(DENY);
      expect(result.stdout, command).toContain('guard.asks: deny');
    }
  });

  test.each([
    ['no manifest', undefined],
    ['a manifest without the key', '{"guard":{"outside":"deny"}}'],
    ['asks set to ask', '{"guard":{"asks":"ask"}}'],
  ])('%s: the answer stays an ask', (_, manifest) => {
    const root = rootWithManifest({ manifest: manifest ?? '{}', script: 'process.exit(3);' });

    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout,
    ).toContain('"permissionDecision":"ask"');
    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).stdout).toContain(
      '"permissionDecision":"ask"',
    );
  });
});

describe('a crashed hook is held by the launch environment and by a manifest that cannot be read', () => {
  const DENY = '"permissionDecision":"deny"';
  const ASK = '"permissionDecision":"ask"';
  const [git] = askingHooks().filter((hook) => hook.command.includes('guard-git.ts'));
  const [outside] = askingHooks().filter((hook) => hook.command.includes('guard-outside.ts'));

  /** A project whose guard-git and guard-outside crash (exit 3), with `manifest` as its manifest when it has one. */
  const crashing = (opts: { manifest?: string }): string => {
    const root = makeRoot();
    const target = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(target, { recursive: true });

    for (const name of ['guard-git', 'guard-outside']) {
      writeFileSync(join(target, `${name}.ts`), 'process.exit(3);');
    }

    if (opts.manifest !== undefined) {
      mkdirSync(join(root, '.agents', 'local'), { recursive: true });
      writeFileSync(join(root, '.agents', 'local', 'vulcan.manifest.json'), opts.manifest);
    }

    return root;
  };

  const answers = (opts: { root: string; env?: Record<string, string> }) => ({
    git: runHook({
      command: git.command,
      root: opts.root,
      env: opts.env,
      stdin: BASH_INPUT('git status'),
    }).stdout,
    outside: runHook({
      command: outside.command,
      root: opts.root,
      env: opts.env,
      stdin: BASH_INPUT('ls'),
    }).stdout,
  });

  test('VULCAN_GUARD_ASKS=deny denies a crash with no manifest and with a manifest that says ask', () => {
    for (const manifest of [undefined, '{"guard":{"asks":"ask"}}', '{}']) {
      const result = answers({ root: crashing({ manifest }), env: { VULCAN_GUARD_ASKS: 'deny' } });

      expect(result.git, String(manifest)).toContain(DENY);
      expect(result.outside, String(manifest)).toContain(DENY);
    }
  });

  test.each(['ask', 'allow', '1', 'true', 'DENY', ''])(
    'VULCAN_GUARD_ASKS=%s is not deny: the crash still asks',
    (value) => {
      const result = answers({ root: crashing({}), env: { VULCAN_GUARD_ASKS: value } });

      expect(result.git).toContain(ASK);
      expect(result.outside).toContain(ASK);
    },
  );

  test.each([
    ['not JSON', '{ nope'],
    ['an empty file', ''],
    ['merge-conflict markers', '<<<<<<< HEAD\n{}\n=======\n{"guard":{}}\n>>>>>>> topic\n'],
    ['an array', '[]'],
    ['a string', '"deny"'],
    ['null', 'null'],
  ])('a manifest that is %s denies a crash', (_, manifest) => {
    const result = answers({ root: crashing({ manifest }) });

    expect(result.git).toContain(DENY);
    expect(result.outside).toContain(DENY);
  });

  test('a manifest that parses and says nothing about asks leaves a crash an ask', () => {
    const result = answers({ root: crashing({ manifest: '{"schemaVersion":1}' }) });

    expect(result.git).toContain(ASK);
    expect(result.outside).toContain(ASK);
  });

  test('the answer of a hook whose import fails (its own catch) follows the same rules', () => {
    for (const [manifest, env, expected] of [
      ['{ nope', undefined, DENY],
      ['{"schemaVersion":1}', { VULCAN_GUARD_ASKS: 'deny' }, DENY],
      ['{"schemaVersion":1}', undefined, ASK],
    ] as const) {
      const root = makeRoot();
      const target = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

      mkdirSync(target, { recursive: true });
      mkdirSync(join(root, '.agents', 'local'), { recursive: true });
      writeFileSync(join(root, '.agents', 'local', 'vulcan.manifest.json'), manifest);

      for (const name of ['guard-git', 'guard-outside']) {
        copyFileSync(join(PACKAGE_ROOT, 'base', 'hooks', `${name}.ts`), join(target, `${name}.ts`));
      }

      expect(
        runHook({ command: git.command, root, env, stdin: BASH_INPUT('git status') }).stdout,
        manifest,
      ).toContain(expected);
      expect(
        runHook({ command: outside.command, root, env, stdin: BASH_INPUT('ls') }).stdout,
        manifest,
      ).toContain(expected);
    }
  });

  test('a git or gh word after a JSON escape is still a git command: true<newline>git reset --hard is not passed', () => {
    const root = crashing({});

    for (const command of ['true\ngit reset --hard', 'true\tgit status', 'echo hi;\rgh pr list']) {
      const result = runHook({ command: git.command, root, stdin: BASH_INPUT(command) });

      expect(result.stdout, command).toContain(ASK);
    }

    for (const command of ['ls\ndigit', 'echo github', 'bun test\nlegit']) {
      const result = runHook({ command: git.command, root, stdin: BASH_INPUT(command) });

      expect(result.stdout, command).toBe('');
    }
  });

  test('the repair command passes only for a Bash call', () => {
    const root = makeRoot();
    const asTool = (tool: string): string =>
      toolEvent({
        tool,
        input: Object.fromEntries([
          ['command', 'bun install'],
          ['file_path', 'x'],
        ]),
        cwd: '/tmp',
      });

    expect(runHook({ command: outside.command, root, stdin: asTool('Bash') }).code).toBe(0);

    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(runHook({ command: outside.command, root, stdin: asTool(tool) }).code, tool).toBe(2);
    }
  });
});

describe('bun does not read the .env or the bunfig.toml of the project into a hook', () => {
  const DENY = '"permissionDecision":"deny"';
  const BUN_FILES: Record<string, string> = {
    '.env': 'VULCAN_GUARDS=off\n',
    'evil.ts': 'process.exit(0);\n',
    'bunfig.toml': 'preload = ["./evil.ts"]\n',
  };
  const hookOf = (name: string): IShippedHook => {
    const [hook] = shippedHooks().filter((item) => item.command.includes(`${name}.ts`));

    return hook;
  };

  /** A project with the real package installed, a manifest that holds every ask, and the two files that would switch a guard off. */
  const planted = (): string => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);
    mkdirSync(join(root, '.agents', 'local'), { recursive: true });
    writeFileSync(
      join(root, '.agents', 'local', 'vulcan.manifest.json'),
      '{"guard":{"asks":"deny"}}',
    );

    for (const [file, text] of Object.entries(BUN_FILES)) {
      writeFileSync(join(root, file), text);
    }

    return root;
  };

  test('guard-git, guard-outside and guard-writes still decide', () => {
    const root = planted();

    expect(
      runHook({
        command: hookOf('guard-git').command,
        root,
        stdin: BASH_INPUT('git reset --hard HEAD~1'),
      }).stdout,
    ).toContain(DENY);
    expect(
      runHook({
        command: hookOf('guard-outside').command,
        root,
        stdin: BASH_INPUT('echo x > .agents/local/vulcan.manifest.json'),
      }).stdout,
    ).toContain(DENY);
    expect(
      runHook({
        command: hookOf('guard-writes').command,
        root,
        stdin: BASH_INPUT('kubectl apply -f x.yaml'),
      }).stdout,
    ).toContain(DENY);
  });

  test('the check of an unreadable manifest in a crash answer is not switched off either', () => {
    const root = makeRoot();
    const target = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(target, { recursive: true });
    mkdirSync(join(root, '.agents', 'local'), { recursive: true });
    writeFileSync(join(root, '.agents', 'local', 'vulcan.manifest.json'), '{ nope');

    for (const [file, text] of Object.entries(BUN_FILES)) {
      writeFileSync(join(root, file), text);
    }

    for (const name of ['guard-git', 'guard-outside']) {
      writeFileSync(join(target, `${name}.ts`), 'process.exit(3);');
    }

    expect(
      runHook({ command: hookOf('guard-git').command, root, stdin: BASH_INPUT('git status') })
        .stdout,
    ).toContain(DENY);
    expect(
      runHook({ command: hookOf('guard-outside').command, root, stdin: BASH_INPUT('ls') }).stdout,
    ).toContain(DENY);
  });
});

describe('the wrappers do not depend on CLAUDE_PROJECT_DIR being set', () => {
  const nameOf = (hook: IShippedHook): string =>
    /hooks\/([\w-]+)\.ts/.exec(hook.command)?.[1] ?? '';

  /** A project with the package installed, so a hook that finds it can run. */
  const installedRoot = (): string => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);

    return root;
  };

  test('every wrapper is written with the working directory as the fallback', () => {
    expect(shippedHooks().length).toBe(5);

    for (const hook of shippedHooks()) {
      expect(hook.command, nameOf(hook)).toContain('${CLAUDE_PROJECT_DIR:-$PWD}/node_modules');
      expect(hook.command, nameOf(hook)).not.toContain('${CLAUDE_PROJECT_DIR}');
    }
  });

  // One test per wrapper and input, two hook runs each: the time of a test does not grow with the number of
  // shipped hooks, which is what once ran a single test of 26 runs into the limit on a loaded machine.
  test.each(
    shippedHooks().flatMap((hook) =>
      ['ls', 'git status', ''].map((command) => ({ name: nameOf(hook), hook, command })),
    ),
  )(
    'with the package present, an unset variable answers like a set one: $name (input $command)',
    ({ name, hook, command }) => {
      const root = installedRoot();
      const stdin = command === '' ? '' : BASH_INPUT(command);
      const set = runHook({ command: hook.command, root, stdin });
      const unset = runHook({ command: hook.command, root, stdin, unsetProjectDir: true });

      expect(unset.code, name).toBe(set.code);
      expect(unset.stdout, name).toBe(set.stdout);
    },
  );

  test.each(shippedHooks().map((hook) => ({ name: nameOf(hook), hook })))(
    'with the package present, an unset variable does not make a safety hook exit 2: $name',
    ({ name, hook }) => {
      const result = runHook({
        command: hook.command,
        root: installedRoot(),
        stdin: BASH_INPUT('ls'),
        unsetProjectDir: true,
      });

      expect(result.code, name).toBe(0);
    },
  );

  test('with the install missing, an unset variable still exits 2 for a safety hook, and for guard-git only on a git line', () => {
    const root = makeRoot();

    for (const hook of shippedHooks()) {
      const result = runHook({
        command: hook.command,
        root,
        stdin: BASH_INPUT('ls'),
        unsetProjectDir: true,
      });
      const passes = hook.command.includes('guard-git.ts');

      expect(result.code, nameOf(hook)).toBe(passes ? 0 : 2);
    }
  });

  test('a variable that is set still wins over the working directory', () => {
    const root = installedRoot();
    const elsewhere = makeRoot();

    for (const hook of closedHooks()) {
      const result = runHook({
        command: hook.command,
        root,
        stdin: BASH_INPUT('ls'),
        env: { CLAUDE_PROJECT_DIR: elsewhere },
      });

      expect(result.code, nameOf(hook)).toBe(2);
    }
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

  test('a broken bunfig.toml of the project does not reach the hook: it runs and decides', () => {
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

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"permissionDecision":"ask"');
  });

  test('bun itself failing before the hook runs still blocks', () => {
    const root = makeRoot();
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');
    const fake = join(root, 'fake-bin');
    const [guard] = shippedHooks().filter((hook) => hook.command.includes('guard-writes.ts'));

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, 'bun'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(fake, 'bun'), 0o755);

    const result = runHook({
      command: guard.command,
      root,
      path: `${fake}:${process.env.PATH ?? ''}`,
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

describe('BUN_OPTIONS, NODE_OPTIONS and BUN_CONFIG_* do not reach a Claude hook', () => {
  const LOADER = {
    BUN_OPTIONS: '',
    NODE_OPTIONS: '--max-old-space-size=256',
    BUN_CONFIG_REGISTRY: 'https://registry.example.test',
    BUN_CONFIG_VERBOSE_FETCH: 'curl',
  };
  const NAMES_SEEN = /^(BUN_OPTIONS|NODE_OPTIONS|BUN_CONFIG_)/;

  /**
   * A project whose five guard scripts record which of those names they inherit, and whose preload file writes a marker:
   * `BUN_OPTIONS=--preload=<it>` runs it before any script bun starts, unless the wrapper took the name out.
   */
  const probed = (): {
    root: string;
    seen: string;
    marker: string;
    env: Record<string, string>;
  } => {
    const root = makeRoot();
    const hooks = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');
    const seen = join(root, 'seen.txt');
    const marker = join(root, 'preload-ran.txt');

    mkdirSync(hooks, { recursive: true });
    writeFileSync(
      join(root, 'preload.ts'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
    );

    for (const name of [
      'guard-writes',
      'guard-git',
      'guard-outside',
      'session-start',
      'subagent-start',
    ]) {
      writeFileSync(
        join(hooks, `${name}.ts`),
        `require('node:fs').appendFileSync(${JSON.stringify(seen)}, Object.keys(process.env).filter((n) => ${NAMES_SEEN}.test(n)).join(',') + '\\n');\n`,
      );
    }

    return {
      root,
      seen,
      marker,
      env: { ...LOADER, BUN_OPTIONS: `--preload=${join(root, 'preload.ts')}` },
    };
  };

  test('the control: bare bun with the variable runs the preload, so the test can fail', () => {
    const { root, marker, env } = probed();

    runHook({ command: 'bun --no-env-file --config=/dev/null -e 0', root, env });

    expect(existsSync(marker)).toBe(true);
  });

  test.each(
    shippedHooks().map((hook) => [/hooks\/([\w-]+)\.ts/.exec(hook.command)?.[1] ?? '', hook]),
  )(
    '%s: the guard script starts with none of the names and the preload does not run',
    (_name, hook) => {
      const { root, seen, marker, env } = probed();
      const result = runHook({ command: hook.command, root, env, stdin: BASH_INPUT('ls') });

      expect(result.code).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(seen, 'utf8').trim()).toBe('');
    },
  );

  test('the manifest check of a crash answer does not run the preload either', () => {
    const { root, marker, env } = probed();
    const hooks = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');

    mkdirSync(join(root, '.agents', 'local'), { recursive: true });
    writeFileSync(join(root, '.agents', 'local', 'vulcan.manifest.json'), '{ nope');

    for (const name of ['guard-git', 'guard-outside']) {
      writeFileSync(join(hooks, `${name}.ts`), 'process.exit(3);');
    }

    for (const name of ['guard-git', 'guard-outside']) {
      const [hook] = shippedHooks().filter((item) => item.command.includes(`${name}.ts`));
      const result = runHook({ command: hook.command, root, env, stdin: BASH_INPUT('git status') });

      expect(result.stdout).toContain('"permissionDecision":"deny"');
      expect(existsSync(marker), name).toBe(false);
    }
  });
});
