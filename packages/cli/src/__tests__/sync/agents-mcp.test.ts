import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atlasServerEntry } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};

const sync = (opts: { root: string; agents: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents], cwd: opts.root });

const readJson = (opts: { root: string; path: string }) =>
  JSON.parse(readFileSync(join(opts.root, opts.path), 'utf8'));

const PROJECT_FILES: [string, string, string][] = [
  ['cursor', '.cursor/mcp.json', 'mcpServers'],
  ['antigravity', '.agents/mcp_config.json', 'mcpServers'],
  ['pi', '.pi/mcp.json', 'mcpServers'],
  ['copilot-vscode', '.vscode/mcp.json', 'servers'],
];

describe('a project that moved', () => {
  for (const [agent, path, key] of PROJECT_FILES) {
    test(`${agent}: the entry follows the project to its new place`, () => {
      const root = createProject({ files: PROJECT });

      sync({ root, agents: agent });

      const file = join(root, path);
      const moved = readFileSync(file, 'utf8').replaceAll(root, '/old/place/demo');

      writeFileSync(file, moved);

      const result = sync({ root, agents: agent });

      expect(result.stderr).toContain(`replaced  ${path}`);
      expect(JSON.stringify(readJson({ root, path })[key].atlas)).toContain(root);
      expect(JSON.stringify(readJson({ root, path })[key].atlas)).not.toContain('/old/place');
    });
  }

  test('an atlas entry the user wrote is left alone after a move too', () => {
    const root = createProject({
      files: {
        ...PROJECT,
        '.cursor/mcp.json': JSON.stringify({ mcpServers: { atlas: { command: 'mine' } } }),
      },
    });

    expect(sync({ root, agents: 'cursor' }).stderr).toContain('unchanged .cursor/mcp.json');
  });
});

describe('vulcan sync writes the atlas entry where each agent reads it', () => {
  for (const [agent, path, key] of PROJECT_FILES) {
    test(`${agent}: ${path} under ${key}`, () => {
      const root = createProject({ files: PROJECT });
      const result = sync({ root, agents: agent });
      const entry = atlasServerEntry({ root });
      const expected = key === 'servers' ? { type: 'stdio', ...entry } : entry;

      expect(result.code).toBe(0);
      expect(readJson({ root, path })[key].atlas).toEqual(expected);
      expect(result.stderr).toContain(`created   ${path}`);
    });
  }

  test('codex: a marker block in .codex/config.toml, and the trust note', () => {
    const root = createProject({ files: PROJECT });
    const result = sync({ root, agents: 'codex' });
    const text = readFileSync(join(root, '.codex/config.toml'), 'utf8');

    expect(text).toContain('# vulcan:atlas:start\n[mcp_servers.atlas]\ncommand = "bun"\n');
    expect(text).toContain(`"--root", "${root}"]`);
    expect(result.stderr).toContain(
      'note      codex: Codex loads .codex/config.toml only for trusted projects',
    );
  });

  test('pi prints its trust note too', () => {
    const root = createProject({ files: PROJECT });

    expect(sync({ root, agents: 'pi' }).stderr).toContain(
      'note      pi: Pi loads .pi/mcp.json and .agents/skills only after you trust this project',
    );
  });

  test('claude, omp and copilot-cli share the committed .mcp.json: sync writes nothing more for them', () => {
    const root = createProject({ files: { ...PROJECT, '.mcp.json': '{ "mcpServers": {} }\n' } });
    const result = sync({ root, agents: 'omp,copilot-cli' });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{ "mcpServers": {} }\n');

    for (const path of ['.cursor', '.pi', '.codex', '.vscode']) {
      expect(existsSync(join(root, path))).toBe(false);
    }
  });

  test('a second run leaves the files alone and reports unchanged', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'cursor,codex' });

    const again = sync({ root, agents: 'cursor,codex' });

    expect(again.stderr).toContain('unchanged .cursor/mcp.json');
    expect(again.stderr).toContain('unchanged .codex/config.toml');
  });

  test("the user's servers and keys in an existing file survive", () => {
    const root = createProject({
      files: {
        ...PROJECT,
        '.cursor/mcp.json': JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: 1 }),
      },
    });

    sync({ root, agents: 'cursor' });

    const after = readJson({ root, path: '.cursor/mcp.json' });

    expect(after.mcpServers.mine).toEqual({ command: 'x' });
    expect(after.other).toBe(1);
    expect(after.mcpServers.atlas.command).toBe('bun');
  });

  test('a file that is not JSON is skipped with the reason, and sync still exits 0', () => {
    const root = createProject({ files: { ...PROJECT, '.cursor/mcp.json': '{ nope' } });
    const result = sync({ root, agents: 'cursor' });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('skipped   .cursor/mcp.json (not valid JSON - left untouched');
    expect(readFileSync(join(root, '.cursor/mcp.json'), 'utf8')).toBe('{ nope');
  });

  test('a file git tracks is not written; the note says what to add', () => {
    const root = createProject({
      files: { ...PROJECT, '.vscode/mcp.json': '{ "servers": {} }\n' },
    });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    Bun.spawnSync(['git', 'add', '.vscode/mcp.json'], { cwd: root });

    const result = sync({ root, agents: 'copilot-vscode' });

    expect(result.stderr).toContain('skipped   .vscode/mcp.json (tracked by git - left alone');
    expect(readFileSync(join(root, '.vscode/mcp.json'), 'utf8')).toBe('{ "servers": {} }\n');
  });

  test('an untracked file in a git repository is written', () => {
    const root = createProject({ files: PROJECT });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });

    expect(sync({ root, agents: 'cursor' }).stderr).toContain('created   .cursor/mcp.json');
  });

  test('--dry-run writes none of it', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync', '--dry-run', '--agents', 'cursor,codex'], cwd: root });

    expect(result.stderr).toContain('would create  .cursor/mcp.json');
    expect(existsSync(join(root, '.cursor'))).toBe(false);
    expect(existsSync(join(root, '.codex'))).toBe(false);
  });

  test('an agent that was not chosen gets nothing', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'cursor' });

    expect(existsSync(join(root, '.codex'))).toBe(false);
    expect(existsSync(join(root, '.pi'))).toBe(false);
  });
});
