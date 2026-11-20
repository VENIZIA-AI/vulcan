import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import vulcanGuards from '../../../base/extensions/vulcan-guards.ts';
import { CodexHooks, GuardHook, GUARD_HOOK_NAME } from '../../agents/index.ts';
import { LoaderEnvironment } from '../../hooks/loader-environment.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const NAMES_SEEN = /^(BUN_OPTIONS|NODE_OPTIONS|BUN_CONFIG_)/;

/** The launch environment of an agent that was started with a loader variable set. */
const loaderEnv = (opts: { preload: string }): Record<string, string> => ({
  BUN_OPTIONS: `--preload=${opts.preload}`,
  NODE_OPTIONS: '--max-old-space-size=256',
  BUN_CONFIG_REGISTRY: 'https://registry.example.test',
  BUN_CONFIG_VERBOSE_FETCH: 'curl',
});

interface IProbe {
  root: string;
  seen: string;
  marker: string;
  env: Record<string, string>;
}

/**
 * A project whose guard scripts (`scripts`) record which stripped names they inherit, and whose preload file writes a
 * marker: `BUN_OPTIONS=--preload=<it>` runs it before any script bun starts, unless the wrapper took the name out.
 */
const probed = (opts: { scripts: string[] }): IProbe => {
  const root = createProject({ files: { 'package.json': '{}' } });
  const hooks = join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks');
  const seen = join(root, 'seen.txt');
  const marker = join(root, 'preload-ran.txt');

  mkdirSync(hooks, { recursive: true });
  mkdirSync(join(root, '.agents'), { recursive: true });
  writeFileSync(
    join(root, 'preload.ts'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
  );

  for (const name of opts.scripts) {
    writeFileSync(
      join(hooks, `${name}.ts`),
      `require('node:fs').appendFileSync(${JSON.stringify(seen)}, Object.keys(process.env).filter((n) => ${NAMES_SEEN}.test(n)).join(',') + '\\n');\n`,
    );
  }

  return { root, seen, marker, env: loaderEnv({ preload: join(root, 'preload.ts') }) };
};

const shell = (opts: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
}) => {
  const result = spawnSyncBounded({
    cmd: ['/bin/sh', '-c', opts.command],
    cwd: opts.cwd,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(opts.cwd), ...opts.env },
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

type THandler = (
  event: { toolName: string; input: Record<string, unknown> },
  context: {
    cwd: string;
    hasUI: boolean;
    ui: { confirm: (title: string, message: string) => Promise<boolean> };
  },
) => Promise<unknown>;

/** The `tool_call` handler the extension registers on a host. */
const handlerOf = (): THandler => {
  let captured: THandler | undefined;

  vulcanGuards({
    on: (_event, handler) => {
      captured = handler;
    },
  });

  if (captured === undefined) {
    throw new Error('the extension registered no tool_call handler');
  }

  return captured;
};

describe('LoaderEnvironment', () => {
  test('strips BUN_OPTIONS, NODE_OPTIONS and every BUN_CONFIG_ name, and nothing else', () => {
    for (const name of ['BUN_OPTIONS', 'NODE_OPTIONS', 'BUN_CONFIG_REGISTRY', 'BUN_CONFIG_']) {
      expect(LoaderEnvironment.isStripped(name), name).toBe(true);
    }

    for (const name of ['BUN_INSTALL', 'NODE_ENV', 'NODE_PATH', 'MY_BUN_OPTIONS', 'PATH']) {
      expect(LoaderEnvironment.isStripped(name), name).toBe(false);
    }

    expect(
      LoaderEnvironment.without({
        BUN_OPTIONS: 'x',
        BUN_CONFIG_TOKEN: 'y',
        PATH: '/bin',
        HOME: '/h',
      }),
    ).toEqual({ PATH: '/bin', HOME: '/h' });
  });

  test('the extension keeps the same names: it imports only node: modules, so it holds its own copy', () => {
    const source = readFileSync(
      join(PACKAGE_ROOT, 'base', 'extensions', 'vulcan-guards.ts'),
      'utf8',
    );

    expect(source).toContain(
      `static readonly WHOLE = [${LoaderEnvironment.NAMES.map((name) => `'${name}'`).join(', ')}];`,
    );
    expect(source).toContain(
      `static readonly PREFIXES = [${LoaderEnvironment.PREFIXES.map((name) => `'${name}'`).join(', ')}];`,
    );
  });

  test('every wrapper starts by unsetting them: Claude Code, Codex and Antigravity', () => {
    const settings: { hooks: Record<string, { hooks: { command: string }[] }[]> } = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'base', 'claude', 'settings.json'), 'utf8'),
    );
    const commands = Object.values(settings.hooks).flatMap((entries) =>
      entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)),
    );
    const codex = CodexHooks.merge({ text: undefined });
    const antigravity = GuardHook.merge({ text: undefined });

    if (!codex.ok || !antigravity.ok) {
      throw new Error('the hooks file did not merge');
    }

    expect(commands.length).toBeGreaterThan(0);

    for (const command of commands) {
      expect(command.startsWith(LoaderEnvironment.shellUnset()), command.slice(0, 60)).toBe(true);
    }

    expect(codex.text).toContain(JSON.stringify(LoaderEnvironment.shellUnset()).slice(1, -1));
    expect(antigravity.text).toContain(JSON.stringify(LoaderEnvironment.shellUnset()).slice(1, -1));
  });
});

describe('BUN_OPTIONS and the other loader names do not reach a guard', () => {
  test('the control: bare bun with the variable runs the preload, so these tests can fail', () => {
    const { root, marker, env } = probed({ scripts: [] });

    shell({ command: 'bun --no-env-file --config=/dev/null -e 0', cwd: root, env });

    expect(existsSync(marker)).toBe(true);
  });

  test('Codex wrapper', () => {
    const { root, seen, marker, env } = probed({ scripts: ['codex-guards'] });
    const merged = CodexHooks.merge({ text: undefined });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const file: { hooks: { PreToolUse: { hooks: { command: string }[] }[] } } = JSON.parse(
      merged.text,
    );
    const result = shell({
      command: file.hooks.PreToolUse[0]?.hooks[0]?.command ?? '',
      cwd: root,
      env,
      stdin: '{}',
    });

    expect(result.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(seen, 'utf8').trim()).toBe('');
  });

  test('Antigravity wrapper, and its crash answer, which runs bun again to read the manifest', () => {
    const { root, seen, marker, env } = probed({ scripts: ['antigravity-guards'] });
    const merged = GuardHook.merge({ text: undefined });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const parsed: Record<string, { PreToolUse: { hooks: { command: string }[] }[] }> = JSON.parse(
      merged.text,
    );
    const command = parsed[GUARD_HOOK_NAME]?.PreToolUse[0]?.hooks[0]?.command ?? '';
    const ran = shell({ command, cwd: join(root, '.agents'), env, stdin: '{}' });

    expect(ran.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(seen, 'utf8').trim()).toBe('');

    writeFileSync(join(root, '.agents', 'vulcan.manifest.json'), '{ nope');
    writeFileSync(
      join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks', 'antigravity-guards.ts'),
      'process.exit(3);',
    );

    const crashed = shell({ command, cwd: join(root, '.agents'), env, stdin: '{}' });

    expect(crashed.stdout).toContain('deny');
    expect(existsSync(marker)).toBe(false);
  });

  test('the omp and pi extension: the guard it starts inherits none of them', async () => {
    const { root, seen, marker, env } = probed({
      scripts: ['guard-writes', 'guard-git', 'guard-outside'],
    });
    const handle = handlerOf();
    const before = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));

    try {
      Object.assign(process.env, env);
      await handle(
        { toolName: 'bash', input: { command: 'ls' } },
        { cwd: root, hasUI: false, ui: { confirm: async () => false } },
      );
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }

    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(seen, 'utf8')).not.toMatch(/[A-Z]/);
  });
});
