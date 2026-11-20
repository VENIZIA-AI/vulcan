import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { installBundle } from '../bundle.helper.ts';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const SHIPPED_SETTINGS = join(PACKAGE_ROOT, 'base', 'claude', 'settings.json');
const DENY = '"permissionDecision":"deny"';
const ASK = '"permissionDecision":"ask"';

// Every test here starts bun processes (a hook, twice in some): its time is the machine's load, not a property of the hooks. A hook that
// hangs still fails: `spawnSyncBounded` kills a spawn after 120 s and throws.
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
  name: string;
  command: string;
}

/** Every hook command the shipped settings register, with the name of the bundle file it runs. */
const shippedHooks = (): IShippedHook[] => {
  const settings: { hooks: Record<string, { hooks: { command: string }[] }[]> } = JSON.parse(
    readFileSync(SHIPPED_SETTINGS, 'utf8'),
  );

  return Object.entries(settings.hooks).flatMap(([event, entries]) =>
    entries.flatMap((entry) =>
      entry.hooks.map((hook) => ({
        event,
        name: /hooks\/([\w-]+)\.js/.exec(hook.command)?.[1] ?? '',
        command: hook.command,
      })),
    ),
  );
};

const hookOf = (name: string): IShippedHook => {
  const [hook] = shippedHooks().filter((item) => item.name === name);

  if (hook === undefined) {
    throw new Error(`no shipped hook named ${name}`);
  }

  return hook;
};

/** The guards that ask when a hook started and then failed; the others block. */
const ASKING = ['guard-git', 'guard-outside'];

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

  delete environment.VULCAN_GUARD_ASKS;
  delete environment.VULCAN_GUARD_OUTSIDE;
  Object.assign(environment, opts.env);

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

  for (const tool of ['cat', 'grep', 'timeout', 'env', 'sed']) {
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

/** A project with the real bundle copied in and its sums committed, as `vulcan sync` and the owner's commit leave it. */
const synced = (opts: { manifest?: string; files?: Record<string, string> } = {}): string => {
  const root = makeRoot();

  installBundle({ root, manifest: opts.manifest, files: opts.files });

  return root;
};

const GIT_CALLS = ['git status', 'gh pr list', 'cd x && git push'];

// Claude Code blocks a PreToolUse call only on exit 2; any other failure lets the call through.
describe('with the bundle missing, the hooks fail closed and nothing repairs it from inside the session', () => {
  const git = hookOf('guard-git');
  const outside = hookOf('guard-outside');

  test('guard-outside blocks every call, guard-git a git or gh line, and the message says who repairs it', () => {
    const root = makeRoot();

    for (const command of ['ls', ...GIT_CALLS]) {
      const result = runHook({ command: outside.command, root, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(2);
      expect(result.stderr, command).toContain('VULCAN guards unavailable');
      expect(result.stderr, command).toContain('.agents/local/hooks/guard-outside.js');
      expect(result.stderr, command).toContain('the owner runs bun node_modules/.bin/vulcan sync');
    }

    for (const command of GIT_CALLS) {
      const result = runHook({ command: git.command, root, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(2);
      expect(result.stderr, command).toContain('VULCAN guards unavailable');
    }

    for (const command of ['ls', 'echo digit', 'bun test']) {
      const result = runHook({ command: git.command, root, stdin: BASH_INPUT(command) });

      expect(result.code, command).toBe(0);
      expect(result.stderr, command).toContain('names no git or gh');
    }
  });

  test.each([
    'bun install',
    'bun i --frozen-lockfile',
    'bun node_modules/.bin/vulcan sync',
    'bun node_modules/.bin/vulcan sync --app apps/web',
  ])('there is no repair command: %s is blocked too', (command) => {
    const root = makeRoot();

    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT(command) }).code).toBe(2);
  });

  test('a call that names no command at all is blocked by guard-outside and passed by guard-git', () => {
    const root = makeRoot();

    expect(runHook({ command: outside.command, root, stdin: '' }).code).toBe(2);
    expect(runHook({ command: git.command, root, stdin: '' }).code).toBe(0);
  });

  test.each(
    shippedHooks()
      .filter((hook) => !ASKING.includes(hook.name))
      .map((hook) => ({ name: hook.name, hook })),
  )('every other hook exits 2 and names the missing file: $name', ({ name, hook }) => {
    const result = runHook({ command: hook.command, root: makeRoot(), stdin: BASH_INPUT('ls') });

    expect(result.code, name).toBe(2);
    expect(result.stderr, name).toContain(`.agents/local/hooks/${name}.js is missing`);
  });

  test('a bundle with one file gone blocks the hook that file is, and only that one', () => {
    const root = makeRoot();

    installBundle({ root, except: ['guard-writes.js'] });

    expect(
      runHook({ command: hookOf('guard-writes').command, root, stdin: BASH_INPUT('ls') }).code,
    ).toBe(2);
    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).code).toBe(0);
    expect(runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).code).toBe(0);
  });

  test('with bun missing from PATH every hook exits 2, and the message names PATH', () => {
    const root = synced();

    for (const hook of shippedHooks()) {
      const result = runHook({
        command: hook.command,
        root,
        path: pathWithoutBun(),
        stdin: BASH_INPUT('git status'),
      });

      expect(result.code, hook.name).toBe(2);

      // The two guards that ask say the bundle or bun is missing; the others name PATH.
      if (!ASKING.includes(hook.name)) {
        expect(result.stderr, hook.name).toContain('PATH');
      }
    }
  });
});

describe('with the bundle in place, the hooks decide', () => {
  test('guard-git, guard-outside and guard-writes answer from the copy in the project', () => {
    const root = synced({ manifest: '{"guard":{"asks":"deny"}}' });

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
        stdin: BASH_INPUT('echo x > .agents/vulcan.manifest.json'),
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

  test('a read passes, and a package that is not there changes nothing', () => {
    const root = synced();

    for (const name of ['guard-git', 'guard-outside', 'guard-writes']) {
      const result = runHook({ command: hookOf(name).command, root, stdin: BASH_INPUT('ls') });

      expect(result.code, name).toBe(0);
      expect(result.stdout.trim(), name).toBe('');
    }

    expect(existsSync(join(root, 'node_modules'))).toBe(false);
  });

  test('VULCAN_GUARDS=off is silent through the wrapper', () => {
    const root = synced();
    const result = runHook({
      command: hookOf('guard-git').command,
      root,
      env: { VULCAN_GUARDS: 'off' },
      stdin: BASH_INPUT('git push --force origin main'),
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('the wrappers are written with the working directory as the fallback, and run without CLAUDE_PROJECT_DIR', () => {
    for (const hook of shippedHooks()) {
      expect(hook.command, hook.name).toContain('${CLAUDE_PROJECT_DIR:-$PWD}');
    }

    const root = synced({ manifest: '{"guard":{"asks":"deny"}}' });
    const result = runHook({
      command: hookOf('guard-git').command,
      root,
      unsetProjectDir: true,
      stdin: `{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD~1"},"cwd":"${root}"}`,
    });

    expect(result.stdout).toContain(DENY);
  });
});

describe('a hook that starts and then fails', () => {
  const git = hookOf('guard-git');
  const outside = hookOf('guard-outside');
  const crashing = (opts: { manifest?: string; script?: string } = {}): string =>
    synced({
      manifest: opts.manifest,
      files: {
        'guard-git.js': opts.script ?? 'process.exit(3);',
        'guard-outside.js': opts.script ?? 'process.exit(3);',
      },
    });

  test.each([
    ['exits non-zero', 'process.exit(3);'],
    ['throws at load', "throw new Error('boom');"],
    ['times out (exit 124 of timeout(1))', 'process.exit(124);'],
  ])('a hook that %s asks, where nothing holds the asks', (_name, script) => {
    const root = crashing({ script });

    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout,
    ).toContain(ASK);
    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).stdout).toContain(
      ASK,
    );
    expect(runHook({ command: git.command, root, stdin: BASH_INPUT('ls') }).code).toBe(0);
  });

  test('a crashed guard-writes blocks', () => {
    const root = synced({ files: { 'guard-writes.js': 'process.exit(3);' } });

    expect(
      runHook({ command: hookOf('guard-writes').command, root, stdin: BASH_INPUT('ls') }).code,
    ).toBe(2);
  });

  test.each([
    ['guard.asks: deny in the manifest', { manifest: '{"guard":{"asks":"deny"}}' }],
    ['a manifest that cannot be read', { manifest: '{ nope' }],
    ['a manifest that is not an object', { manifest: '[]' }],
    [
      'VULCAN_GUARD_ASKS=deny in the launch environment, with no manifest',
      { env: { VULCAN_GUARD_ASKS: 'deny' } },
    ],
    [
      'VULCAN_GUARD_ASKS=deny over a manifest that says ask',
      { manifest: '{"guard":{"asks":"ask"}}', env: { VULCAN_GUARD_ASKS: 'deny' } },
    ],
  ])(
    '%s: the crash is a deny',
    (_name, hold: { manifest?: string; env?: Record<string, string> }) => {
      const root = crashing({ manifest: hold.manifest });

      for (const [hook, command] of [
        [git, 'git status'],
        [outside, 'ls'],
      ] as const) {
        const result = runHook({
          command: hook.command,
          root,
          env: hold.env,
          stdin: BASH_INPUT(command),
        });

        expect(result.stdout, command).toContain(DENY);
      }
    },
  );

  test.each([
    ['no manifest', undefined],
    ['a manifest without the key', '{"guard":{"outside":"deny"}}'],
    ['asks set to ask', '{"guard":{"asks":"ask"}}'],
  ])('%s: the crash stays an ask', (_name, manifest) => {
    const root = crashing({ manifest });

    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git status') }).stdout,
    ).toContain(ASK);
    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).stdout).toContain(
      ASK,
    );
  });

  test.each(['ask', 'allow', '1', 'true', 'DENY', ''])(
    'VULCAN_GUARD_ASKS=%p is not a hold: only the exact word deny is',
    (value) => {
      const root = crashing();

      expect(
        runHook({
          command: git.command,
          root,
          env: { VULCAN_GUARD_ASKS: value },
          stdin: BASH_INPUT('git status'),
        }).stdout,
      ).toContain(ASK);
    },
  );

  test('a git or gh word after a JSON escape is still a git command: true<newline>git reset --hard is not passed', () => {
    const root = crashing({ manifest: '{"guard":{"asks":"deny"}}' });
    const result = runHook({
      command: git.command,
      root,
      stdin: '{"tool_name":"Bash","tool_input":{"command":"true\\ngit reset --hard"},"cwd":"/tmp"}',
    });

    expect(result.stdout).toContain(DENY);
  });

  test('the repair command is no exception: bun install is judged like any call', () => {
    const root = crashing({ manifest: '{"guard":{"asks":"deny"}}' });

    expect(
      runHook({ command: outside.command, root, stdin: BASH_INPUT('bun install') }).stdout,
    ).toContain(DENY);
  });
});

describe('bun does not read the .env or the bunfig.toml of the project into a hook', () => {
  const planted = (): string => {
    const root = synced({ manifest: '{"guard":{"asks":"deny"}}' });

    writeFileSync(join(root, '.env'), 'VULCAN_GUARDS=off\n');
    writeFileSync(join(root, 'evil.ts'), 'process.exit(0);\n');
    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./evil.ts"]\n');

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
        stdin: BASH_INPUT('echo x > .agents/vulcan.manifest.json'),
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

  test('a broken bunfig.toml does not reach the hook: it runs and decides', () => {
    const root = synced({ manifest: '{"guard":{"asks":"deny"}}' });

    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./missing-preload.ts"]\n');

    expect(
      runHook({
        command: hookOf('guard-git').command,
        root,
        stdin: BASH_INPUT('git reset --hard HEAD~1'),
      }).stdout,
    ).toContain(DENY);
  });

  test('the check of an unreadable manifest in a crash answer is not switched off either', () => {
    const root = synced({
      manifest: '{ nope',
      files: { 'guard-git.js': 'process.exit(3);', 'guard-outside.js': 'process.exit(3);' },
    });

    writeFileSync(join(root, '.env'), 'VULCAN_GUARDS=off\n');
    writeFileSync(join(root, 'evil.ts'), 'process.exit(0);\n');
    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./evil.ts"]\n');

    expect(
      runHook({ command: hookOf('guard-git').command, root, stdin: BASH_INPUT('git status') })
        .stdout,
    ).toContain(DENY);
    expect(
      runHook({ command: hookOf('guard-outside').command, root, stdin: BASH_INPUT('ls') }).stdout,
    ).toContain(DENY);
  });
});

describe('a bundle runs only if it is the one the manifest at HEAD records', () => {
  const git = hookOf('guard-git');
  const outside = hookOf('guard-outside');
  const writes = hookOf('guard-writes');
  const REFUSAL = 'is not the one the manifest at HEAD records';

  const gitIn = (opts: { root: string; args: string[] }): void => {
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

  test('the committed sums match: the hook runs and decides', () => {
    const root = synced({ manifest: '{"guard":{"asks":"deny"}}' });

    expect(
      runHook({ command: git.command, root, stdin: BASH_INPUT('git reset --hard HEAD~1') }).stdout,
    ).toContain(DENY);
  });

  test.each(shippedHooks().map((hook) => ({ name: hook.name, hook })))(
    'a bundle file changed after the commit is refused and blocks, whatever the call: $name',
    ({ name, hook }) => {
      const root = synced();
      const file = join(root, '.agents', 'local', 'hooks', `${name}.js`);

      chmodSync(file, 0o644);
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n// the agent was here\n`);

      const result = runHook({ command: hook.command, root, stdin: BASH_INPUT('git status') });

      // The event hooks of the settings are separate commands; these are the guards and the session hooks.
      expect(result.code, name).toBe(2);
      expect(result.stderr, name).toContain(REFUSAL);
      expect(result.stdout, name).not.toContain('permissionDecision":"allow"');
    },
  );

  test('the working tree manifest does not count, only HEAD: new sums in the file are not trusted until committed', () => {
    const root = synced();
    const path = join(root, '.agents', 'vulcan.manifest.json');
    const file = join(root, '.agents', 'local', 'hooks', 'guard-outside.js');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));

    chmodSync(file, 0o644);
    writeFileSync(file, '// not the committed bundle\nprocess.exit(0);\n');
    manifest.hooks.sha256['guard-outside.js'] = new Bun.CryptoHasher('sha256')
      .update(readFileSync(file))
      .digest('hex');
    writeFileSync(path, `${JSON.stringify(manifest)}\n`);

    const refused = runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') });

    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(REFUSAL);

    // Once the owner commits the manifest, the same bundle runs.
    gitIn({ root, args: ['add', '.agents/vulcan.manifest.json'] });
    gitIn({ root, args: ['commit', '-q', '-m', 'sums'] });

    expect(runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') }).code).toBe(0);
  });

  test('an entry missing from the manifest at HEAD refuses the file', () => {
    const root = synced();
    const path = join(root, '.agents', 'vulcan.manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));

    delete manifest.hooks.sha256['guard-writes.js'];
    writeFileSync(path, `${JSON.stringify(manifest)}\n`);
    gitIn({ root, args: ['commit', '-q', '-am', 'drop an entry'] });

    const result = runHook({ command: writes.command, root, stdin: BASH_INPUT('ls') });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(REFUSAL);
  });

  test('no git repository, or a manifest that was never committed, refuses too: nothing runs on trust', () => {
    const bare = makeRoot();
    const uncommitted = makeRoot();

    installBundle({ root: bare });
    rmSync(join(bare, '.git'), { recursive: true, force: true });
    installBundle({ root: uncommitted });
    gitIn({ root: uncommitted, args: ['reset', '-q', '--soft', 'HEAD~0'] });
    rmSync(join(uncommitted, '.git'), { recursive: true, force: true });
    gitIn({ root: uncommitted, args: ['init', '-q', '-b', 'main'] });

    for (const root of [bare, uncommitted]) {
      const result = runHook({ command: writes.command, root, stdin: BASH_INPUT('ls') });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain(REFUSAL);
    }
  });

  test('a refusal blocks guard-git and guard-outside: it is not an ask a person could wave through', () => {
    const root = synced();
    const file = join(root, '.agents', 'local', 'hooks', 'guard-git.js');

    chmodSync(file, 0o644);
    writeFileSync(file, 'console.log("{}");\n');

    const result = runHook({ command: git.command, root, stdin: BASH_INPUT('git status') });

    expect(result.code).toBe(2);
    expect(result.stdout).not.toContain(ASK);
  });

  test('a refusal of an event hook runs nothing and does not block the session', () => {
    const events = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'base', 'claude', 'events.json'), 'utf8'),
    );
    const [first] = Object.values<{ hooks: { command: string }[] }[]>(events.hooks).flat();
    const root = synced();
    const file = join(root, '.agents', 'local', 'hooks', 'event.js');
    const marker = join(root, 'event-ran.txt');

    chmodSync(file, 0o644);
    writeFileSync(file, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);

    const result = runHook({ command: first?.hooks[0]?.command ?? '', root, stdin: '{}' });

    expect(result.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test('the cost of the check: one git show and one hash beside the hook', () => {
    const root = synced();
    const run = (): number => {
      const start = performance.now();

      runHook({ command: outside.command, root, stdin: BASH_INPUT('ls') });

      return performance.now() - start;
    };

    run();

    const median = [run(), run(), run(), run(), run()].sort((a, b) => a - b)[2] ?? 0;

    // Printed so a release can state the per-call cost; the bound only catches a loader that stopped being cheap.
    console.log(
      `loader: guard-outside through the wrapper, median of 5 runs: ${median.toFixed(0)} ms`,
    );
    expect(median).toBeLessThan(2000);
  });
});

describe('BUN_OPTIONS, NODE_OPTIONS and BUN_CONFIG_* do not reach a Claude hook', () => {
  const LOADER = {
    BUN_OPTIONS: '',
    NODE_OPTIONS: '--max-old-space-size=256',
    BUN_CONFIG_REGISTRY: 'https://registry.example.test',
    BUN_CONFIG_VERBOSE_FETCH: 'curl',
  };
  const NAMES_SEEN = /^(BUN_OPTIONS|NODE_OPTIONS|BUN_CONFIG_|BUN_INSPECT)/;

  /**
   * A project whose five hooks record which of those names they inherit, and whose preload file writes a marker:
   * `BUN_OPTIONS=--preload=<it>` runs it before any script bun starts, unless the wrapper took the name out.
   */
  const probed = (
    opts: { files?: Record<string, string>; manifest?: string } = {},
  ): {
    root: string;
    seen: string;
    marker: string;
    env: Record<string, string>;
  } => {
    const root = makeRoot();
    const seen = join(root, 'seen.txt');
    const marker = join(root, 'preload-ran.txt');
    const probe = `require('node:fs').appendFileSync(${JSON.stringify(seen)}, Object.keys(process.env).filter((n) => ${NAMES_SEEN}.test(n)).join(',') + '\\n');\n`;
    const files = Object.fromEntries(
      [
        'guard-writes',
        'guard-git',
        'guard-outside',
        'session-start',
        'subagent-start',
        'event',
      ].map((name) => [`${name}.js`, probe]),
    );

    installBundle({
      root,
      bare: true,
      files: { ...files, ...opts.files },
      manifest: opts.manifest,
    });
    writeFileSync(
      join(root, 'preload.ts'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
    );

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

  test.each(shippedHooks().map((hook) => ({ name: hook.name, hook })))(
    '%s: the hook starts with none of the names and the preload does not run',
    ({ hook }) => {
      const { root, seen, marker, env } = probed();
      const result = runHook({ command: hook.command, root, env, stdin: BASH_INPUT('ls') });

      expect(result.code).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(seen, 'utf8').trim()).toBe('');
    },
  );

  test('the manifest check of a crash answer does not run the preload either', () => {
    const { root, marker, env } = probed({
      files: { 'guard-git.js': 'process.exit(3);', 'guard-outside.js': 'process.exit(3);' },
      manifest: '{ nope',
    });

    for (const name of ['guard-git', 'guard-outside']) {
      const result = runHook({
        command: hookOf(name).command,
        root,
        env,
        stdin: BASH_INPUT('git status'),
      });

      expect(result.stdout).toContain(DENY);
      expect(existsSync(marker), name).toBe(false);
    }
  });
});
