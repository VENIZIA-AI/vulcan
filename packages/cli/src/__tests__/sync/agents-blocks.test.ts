import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RulesBlock } from '../../agents/index.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const MCP = JSON.stringify({
  mcpServers: {
    atlas: { command: 'bun', args: ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp'] },
  },
});
const CONFIG = [
  'export default {',
  "  name: 'acme',",
  "  rules: { 'V-W-01': 'read-only' },",
  "  atlas: { sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' }] },",
  '};',
  '',
].join('\n');
const AGENTS_MD = '# AGENTS.md\n\n## Must read first\n\n| a | b |\n\n## Commands\n\n| c | d |\n';

const project = (opts: { mcp?: boolean; agents?: string } = {}) =>
  createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      'AGENTS.md': AGENTS_MD,
      ...(opts.mcp === false ? {} : { '.mcp.json': MCP }),
    },
  });

const sync = (opts: { root: string; agents?: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents ?? 'omp'], cwd: opts.root });

describe('the Atlas and rules blocks in AGENTS.md', () => {
  test('sync inserts it for every agent, built from the config', () => {
    const root = project();
    const result = sync({ root });
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');

    expect(result.stderr).toContain('replaced  AGENTS.md (Atlas and rules blocks)');
    expect(text).toContain('<!-- vulcan:atlas:start');
    expect(text).toContain('acme (this repository), ignis');
    expect(text.indexOf('<!-- vulcan:atlas:end')).toBeLessThan(text.indexOf('## Commands'));
  });

  test('the rules block sits before the Atlas block, built from the config, with no path of this machine', () => {
    const root = project();

    sync({ root });

    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const block = text.slice(
      text.indexOf('<!-- vulcan:rules:start'),
      text.indexOf('<!-- vulcan:rules:end'),
    );

    expect(text.indexOf('vulcan:rules:start')).toBeLessThan(text.indexOf('vulcan:atlas:start'));
    expect(text.indexOf('vulcan:atlas:end')).toBeLessThan(text.indexOf('## Commands'));
    expect(block).toContain('- V-W-01: this project: `read-only`');
    expect(block).toContain('`.agents/local/tmp`');
    expect(block).not.toContain(root);
    expect(Buffer.byteLength(block)).toBeLessThanOrEqual(RulesBlock.MAX_BYTES);
  });

  test('a change of the slot choice or of the often-dropped list rewrites the rules block only', () => {
    const root = project();

    sync({ root });
    writeFileSync(
      join(root, '.configs/vulcan.config.mts'),
      CONFIG.replace("'read-only'", "'on-user-word'").replace(
        '  atlas:',
        "  digest: { oftenDropped: ['V-B-03'] },\n  atlas:",
      ),
    );
    sync({ root });

    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const block = text.slice(
      text.indexOf('<!-- vulcan:rules:start'),
      text.indexOf('<!-- vulcan:rules:end'),
    );

    expect(block).toContain('- V-W-01: this project: `on-user-word`');
    expect(block).toContain('- V-B-03:');
    expect(block).not.toContain('- V-P-07:');
    expect(text).toContain('acme (this repository), ignis');
  });

  test('doctor says the rules block is out of date after the config changes', async () => {
    const root = project();

    sync({ root });
    writeFileSync(
      join(root, '.configs/vulcan.config.mts'),
      CONFIG.replace("'read-only'", "'on-user-word'"),
    );

    const result = await DoctorRunner.runNotes({ root });

    expect(result.map((note) => note.file)).toContain('AGENTS.md');
  });

  test('it is not tied to Claude: an agent list without claude gets it too', () => {
    const root = project();

    sync({ root, agents: 'none' });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('vulcan:atlas:start');
  });

  test('it does not wait for a .mcp.json: a machine of an agent that has its own MCP file gets it too', () => {
    const root = project({ mcp: false });
    const result = sync({ root, agents: 'antigravity' });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('vulcan:atlas:start');
    expect(result.stderr).toContain('replaced  AGENTS.md (Atlas and rules blocks)');
  });

  test('a second run reports it unchanged', () => {
    const root = project();

    sync({ root });

    expect(sync({ root }).stderr).toContain('unchanged AGENTS.md');
  });

  test('a change in the config rewrites only the block', () => {
    const root = project();

    sync({ root });
    writeFileSync(
      join(root, '.configs/vulcan.config.mts'),
      CONFIG.replace("[{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' }]", '[]'),
    );

    const result = sync({ root });
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');

    expect(result.stderr).toContain('replaced  AGENTS.md (Atlas and rules blocks)');
    expect(text).toContain('acme (this repository).');
    expect(text).not.toContain('ignis');
    expect(text.startsWith('# AGENTS.md\n\n## Must read first')).toBe(true);
  });

  test('--dry-run writes nothing', () => {
    const root = project();

    runCli({ args: ['sync', '--dry-run', '--agents', 'omp'], cwd: root });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD);
  });

  test('doctor notes (info, never a failure) a missing block and then a current one', async () => {
    const root = project();
    const before = await DoctorRunner.runNotes({ root });

    expect(before.map((note) => note.file)).toContain('AGENTS.md');
    expect(before.find((note) => note.file === 'AGENTS.md')?.message).toBe(
      "the Atlas or rules block of AGENTS.md is missing or out of date - run 'bun x --no-install vulcan sync'",
    );

    sync({ root });

    const result = await DoctorRunner.runNotes({ root });
    expect(result.map((note) => note.file)).not.toContain('AGENTS.md');
    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('rules block');
  });

  test('doctor notes a missing block whether or not a .mcp.json exists', async () => {
    const root = project({ mcp: false });

    const result = await DoctorRunner.runNotes({ root });
    expect(result.map((note) => note.file)).toContain('AGENTS.md');
  });
});
