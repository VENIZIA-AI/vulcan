import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildToolEnvironment, resolveToolBin } from '../../commands/x.command.ts';
import { VulcanTools } from '../../common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { SPAWN_TIMEOUT_MS } from '../spawn.helper.ts';

afterAll(removeProjects);

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');

describe('vulcan x', () => {
  test('resolves the okf bin from the installed package', () => {
    expect(resolveToolBin({ name: VulcanTools.OKF })).toMatch(/okf\/src\/cli\.ts$/);
  });

  test('an unknown tool exits 1 and lists the known tools on stderr', () => {
    const result = runCli({ args: ['x', 'nope'], cwd: tmpdir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown tool 'nope'");
    expect(result.stderr).toContain('okf, atlas');
    expect(result.stdout).toBe('');
  });

  test('no tool exits 1 with the list', () => {
    expect(runCli({ args: ['x'], cwd: tmpdir() }).code).toBe(1);
  });

  test("the tool's exit code passes through unchanged (okf usage error is 2)", () => {
    const result = runCli({ args: ['x', 'okf'], cwd: tmpdir() });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage: vulcan x okf');
  });

  test('vulcan itself writes nothing to stdout - MCP owns it', () => {
    expect(runCli({ args: ['x', 'okf', 'nope'], cwd: tmpdir() }).stdout).toBe('');
  });

  const atlasBin = resolveToolBin({ name: VulcanTools.ATLAS });

  test.skipIf(atlasBin === undefined || !existsSync(atlasBin))(
    'x atlas mcp answers initialize with JSON-RPC only on stdout',
    async () => {
      // atlas ships code only: it serves a project, so the test makes one.
      const root = createProject({
        files: {
          '.configs/vulcan.config.ts': 'export default {};\n',
          '.agents/knowledge/index.md': '# Probe\n',
        },
      });
      const child = Bun.spawn([process.execPath, CLI, 'x', 'atlas', 'mcp'], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      const initialize = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'x-test', version: '0' },
        },
      };

      await child.stdin.write(`${JSON.stringify(initialize)}\n`);
      await child.stdin.end();

      const stdout = await new Response(child.stdout).text();

      await child.exited;
      const lines = stdout.trim().split('\n').filter(Boolean);

      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        expect(JSON.parse(line).jsonrpc).toBe('2.0');
      }
    },
  );

  test.skipIf(atlasBin === undefined || !existsSync(atlasBin))(
    'x atlas mcp outside any project, with no source, exits 2 and says how to get one',
    () => {
      const result = runCli({
        args: ['x', 'atlas', 'mcp'],
        cwd: tmpdir(),
        env: { XDG_CONFIG_HOME: join(tmpdir(), 'vulcan-x-test-no-config') },
      });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('nothing to serve');
      expect(result.stderr).toContain('--source <owner/repo>@<ref>');
      expect(result.stdout).toBe('');
    },
  );
});

describe('buildToolEnvironment', () => {
  test('a valid config reaches the tool resolved, with the project root', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts':
          "export default { atlas: { packages: { kernel: '@a/kernel' } } };\n",
      },
    });
    const environment = await buildToolEnvironment({ root });

    expect(environment.ok).toBe(true);

    if (environment.ok) {
      const config = JSON.parse(environment.env.VULCAN_CONFIG ?? '{}');

      expect(environment.env.VULCAN_PROJECT_ROOT).toBe(root);
      expect(config.packages).toEqual([
        { dir: 'kernel', name: '@a/kernel', path: 'packages/kernel', aliases: [], retired: false },
      ]);
      expect(config.okf.renderers).toEqual([]);
    }
  });

  test('no config: the tool runs without one', async () => {
    const root = createProject({ files: {} });

    expect(await buildToolEnvironment({ root })).toEqual({ ok: true, env: {} });
  });

  test('an invalid config stops vulcan x before the tool runs', () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': 'export default { nope: 1 };\n' },
    });
    const result = runCli({ args: ['x', 'okf', 'check'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('invalid config');
  });
});
