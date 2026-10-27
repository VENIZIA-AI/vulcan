import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');

const CONFIG = (extra: string): string =>
  `export default { rules: { 'V-W-01': 'on-user-word' }, ${extra} };\n`;
const REMOTE_HOSTS = "remoteHosts: { trusted: ['lab1', '*.lab.example.com'], readOnly: ['prod1'] }";

const readSettings = (opts: { root: string }) =>
  JSON.parse(readFileSync(join(opts.root, '.claude', 'settings.json'), 'utf8'));

/** Every command the synced settings register for Bash PreToolUse. */
const bashHooks = (opts: { root: string }): string[] =>
  (readSettings(opts).hooks.PreToolUse as { matcher: string; hooks: { command: string }[] }[])
    .filter((entry) => entry.matcher === 'Bash')
    .flatMap((entry) => entry.hooks.map((hook) => hook.command));

const remoteHook = (opts: { root: string }): string | undefined =>
  bashHooks(opts).find((command) => command.includes('guard-remote-hosts.ts'));

/** A synced project with the package linked into node_modules, as `bun install` leaves it. */
const makeProject = (opts: { config: string; files?: Record<string, string> }): string => {
  const root = createProject({
    files: { 'AGENTS.md': '# x\n', '.configs/vulcan.config.ts': opts.config, ...opts.files },
  });
  const installed = join(root, 'node_modules', '@venizia', 'vulcan');

  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync(PACKAGE_ROOT, installed);
  runCli({ args: ['sync'], cwd: root });

  return root;
};

const runHook = (opts: { root: string; command: string; input: string }) => {
  const result = spawnSyncBounded({
    cmd: ['/bin/sh', '-c', opts.command],
    cwd: opts.root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root },
    stdin: new Blob([opts.input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const BASH = (command: string): string =>
  `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(command)}}}`;

describe('sync registers the guard only for a project that sets remoteHosts', () => {
  test('with remoteHosts: the hook is registered and the manifest carries the policy', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const manifest = JSON.parse(readFileSync(join(root, '.agents/vulcan.manifest.json'), 'utf8'));

    expect(remoteHook({ root })).toBeDefined();
    expect(manifest.remoteHosts).toEqual({
      trusted: ['lab1', '*.lab.example.com'],
      readOnly: ['prod1'],
      localFile: '.agents/hooks/trusted-hosts.local',
    });
  });

  test('without it: no hook, no manifest key', () => {
    const root = makeProject({ config: CONFIG('') });
    const manifest = JSON.parse(readFileSync(join(root, '.agents/vulcan.manifest.json'), 'utf8'));

    expect(remoteHook({ root })).toBeUndefined();
    expect(manifest.remoteHosts).toBeUndefined();
  });

  test('removing the key and syncing again takes the hook back', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });

    writeFileSync(join(root, '.configs/vulcan.config.ts'), CONFIG(''));
    runCli({ args: ['sync'], cwd: root });
    expect(remoteHook({ root })).toBeUndefined();
  });

  test('a second sync changes nothing, and doctor stays green about it', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const again = runCli({ args: ['sync'], cwd: root });

    expect(again.stderr).not.toContain('replaced');
    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('[adapters]');
    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('[manifest]');
  });
});

describe('the registered hook, run as Claude Code runs it', () => {
  test('a trusted host passes silently, an unlisted one asks and names it', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const command = remoteHook({ root }) ?? '';
    const trusted = runHook({ root, command, input: BASH('ssh lab1 systemctl restart nginx') });
    const unlisted = runHook({ root, command, input: BASH('ssh evil.com uptime') });
    const lookalike = runHook({ root, command, input: BASH('ssh lab1.evil.com uptime') });
    const unrelated = runHook({ root, command, input: BASH('ls -la') });

    expect(trusted.code).toBe(0);
    expect(trusted.stdout).toBe('');
    expect(unrelated.stdout).toBe('');
    expect(unlisted.code).toBe(0);
    expect(unlisted.stdout).toContain('"permissionDecision":"ask"');
    expect(unlisted.stdout).toContain("'evil.com'");
    expect(lookalike.stdout).toContain('"permissionDecision":"ask"');
  });

  test('a readOnly host passes the strict forms and asks for anything else', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const command = remoteHook({ root }) ?? '';

    expect(runHook({ root, command, input: BASH('ssh prod1 uptime') }).stdout).toBe('');
    expect(runHook({ root, command, input: BASH('ssh prod1 reboot') }).stdout).toContain('"ask"');
  });

  test('the personal list adds trusted hosts, one per line, comments allowed', () => {
    const root = makeProject({
      config: CONFIG(REMOTE_HOSTS),
      files: { '.agents/hooks/trusted-hosts.local': '# mine\nmy-laptop.lan\n' },
    });
    const command = remoteHook({ root }) ?? '';

    expect(runHook({ root, command, input: BASH('ssh my-laptop.lan make install') }).stdout).toBe(
      '',
    );
    expect(runHook({ root, command, input: BASH('ssh my-laptop.lan.evil.com') }).stdout).toContain(
      '"ask"',
    );
  });

  test('unreadable hook input asks', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const result = runHook({ root, command: remoteHook({ root }) ?? '', input: 'not json' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"ask"');
  });
});

describe('the hook fails closed', () => {
  test('with node_modules/@venizia/vulcan missing it exits 2 and says to run bun install', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const command = remoteHook({ root }) ?? '';

    rmSync(join(root, 'node_modules'), { recursive: true, force: true });

    const result = runHook({ root, command, input: BASH('ssh lab1') });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('node_modules/@venizia/vulcan is missing - run bun install');
  });

  test('with bun missing from PATH it exits 2', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const result = spawnSyncBounded({
      cmd: ['/bin/sh', '-c', remoteHook({ root }) ?? ''],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: '/nonexistent' },
      stdin: new Blob([BASH('ssh lab1')]),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('bun is not on PATH');
  });

  test('a manifest without the policy exits 2 and says to sync', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const command = remoteHook({ root }) ?? '';

    writeFileSync(join(root, '.agents/vulcan.manifest.json'), '{ "schemaVersion": 1 }\n');

    const result = runHook({ root, command, input: BASH('ssh lab1') });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('run vulcan sync');
  });

  test('a missing manifest exits 2', () => {
    const root = makeProject({ config: CONFIG(REMOTE_HOSTS) });
    const command = remoteHook({ root }) ?? '';

    rmSync(join(root, '.agents/vulcan.manifest.json'));

    expect(runHook({ root, command, input: BASH('ssh lab1') }).code).toBe(2);
  });
});

describe('remoteHosts entries are validated', () => {
  const messageOf = (entries: string[]): string | undefined => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ remoteHosts: { trusted: entries } });

    return result.success
      ? undefined
      : result.error.issues.map((issue) => issue.message).join('; ');
  };

  test.each([
    'lab1',
    '*.lab.example.com',
    '10.0.0.5',
    'lab-1.example.com',
    '$LAB_HOST',
    '${LAB_HOST}',
  ])('%s is a host or a pattern', (entry) => {
    expect(messageOf([entry])).toBeUndefined();
  });

  test.each(['*', '**', '*.*', '.', 'user@lab1', 'lab1:22', 'lab1/path', 'ssh://lab1', 'a b', ''])(
    "'%s' is refused",
    (entry) => {
      expect(messageOf([entry])).toBeDefined();
    },
  );
});
