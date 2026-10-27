import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A copy of the shipped package with `zod` broken, and every module that is
 * not on a blocking hook's path made to throw when it loads: the config loader, the rules reader,
 * the digest and the hooks barrel. The blocking hooks must work all the same - a release that breaks
 * one of those modules must not stop every tool call in every project.
 */
const brokenInstall = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-isolated-'));
  const installed = join(root, 'node_modules', '@venizia', 'vulcan');

  roots.push(root);
  mkdirSync(installed, { recursive: true });
  cpSync(join(PACKAGE_ROOT, 'src'), join(installed, 'src'), {
    recursive: true,
    filter: (source) => !source.includes('__tests__'),
  });
  cpSync(join(PACKAGE_ROOT, 'base', 'hooks'), join(installed, 'base', 'hooks'), {
    recursive: true,
  });

  // `zod` is made to throw when it loads: the folder may sit inside a repository whose node_modules would
  // otherwise resolve it.
  mkdirSync(join(root, 'node_modules', 'zod'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules', 'zod', 'package.json'),
    '{"name":"zod","main":"index.js"}',
  );
  writeFileSync(
    join(root, 'node_modules', 'zod', 'index.js'),
    'throw new Error("zod is broken");\n',
  );

  for (const file of [
    'src/config/index.ts',
    'src/rules/index.ts',
    'src/hooks/session-digest.ts',
    'src/hooks/index.ts',
  ]) {
    writeFileSync(join(installed, file), 'throw new Error("a bad release broke this module");\n');
  }

  return root;
};

const root = brokenInstall();

const run = async (opts: { hook: string; payload: string }) => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks', `${opts.hook}.ts`),
    ],
    {
      cwd: root,
      stdin: new TextEncoder().encode(opts.payload),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  );
  const stdout = (await new Response(child.stdout).text()).trim();
  const stderr = await new Response(child.stderr).text();

  return { code: await child.exited, stdout, stderr };
};
const bash = (command: string): string =>
  `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(command)}},"cwd":${JSON.stringify(root)}}`;
const write = (file: string): string =>
  `{"tool_name":"Write","tool_input":{"file_path":${JSON.stringify(file)}},"cwd":${JSON.stringify(root)}}`;
const decisionOf = (stdout: string): string =>
  JSON.parse(stdout).hookSpecificOutput.permissionDecision;

describe('the blocking hooks do not depend on config, rules, the digest or zod', () => {
  test('guard-remote-hosts asks about an unlisted host and passes a local command', async () => {
    const manifest = join(root, '.agents', 'vulcan.manifest.json');

    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        remoteHosts: { trusted: ['example.test'], readOnly: [] },
      }),
    );

    const remote = await run({
      hook: 'guard-remote-hosts',
      payload: bash('curl https://evil.test/x'),
    });
    const local = await run({ hook: 'guard-remote-hosts', payload: bash('ls') });

    expect(remote.code).toBe(0);
    expect(local.code).toBe(0);
    expect(local.stdout).toBe('');
  });

  test('guard-writes asks for a deploy and passes a read', async () => {
    const deploy = await run({ hook: 'guard-writes', payload: bash('kubectl apply -f m.yaml') });
    const read = await run({ hook: 'guard-writes', payload: bash('ls') });

    expect(deploy.code).toBe(0);
    expect(decisionOf(deploy.stdout)).toBe('ask');
    expect(read).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('guard-manifest denies a write to the manifest and passes another file', async () => {
    const manifest = await run({
      hook: 'guard-manifest',
      payload: write(join(root, '.agents/vulcan.manifest.json')),
    });
    const other = await run({ hook: 'guard-manifest', payload: write(join(root, 'a.txt')) });

    expect(decisionOf(manifest.stdout)).toBe('deny');
    expect(other).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('guard-package passes a Write that is not a new package.json', async () => {
    expect(await run({ hook: 'guard-package', payload: write(join(root, 'a.txt')) })).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    });
  });

  test('guard-git denies a force-push to main and passes a status', async () => {
    const push = await run({ hook: 'guard-git', payload: bash('git push -f origin main') });
    const status = await run({ hook: 'guard-git', payload: bash('git status') });

    expect(decisionOf(push.stdout)).toBe('deny');
    expect(status).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('guard-outside asks for a write outside the project, whose config it cannot read, and passes one inside', async () => {
    const outside = await run({ hook: 'guard-outside', payload: bash('mkdir /var/tmp/x-vulcan') });
    const inside = await run({
      hook: 'guard-outside',
      payload: bash('mkdir -p .agents/local/tmp/a'),
    });

    expect(decisionOf(outside.stdout)).toBe('ask');
    expect(outside.stderr).toContain('could not read the project config');
    expect(inside.stdout).toBe('');
    expect(inside.code).toBe(0);
  });
});
