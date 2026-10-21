import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDoctorNotes } from '../../doctor/index.ts';
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
      '.configs/vulcan.config.ts': CONFIG,
      'AGENTS.md': AGENTS_MD,
      ...(opts.mcp === false ? {} : { '.mcp.json': MCP }),
    },
  });

const sync = (opts: { root: string; agents?: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents ?? 'omp'], cwd: opts.root });

describe('the Atlas block in AGENTS.md', () => {
  test('sync inserts it for every agent, built from the config', () => {
    const root = project();
    const result = sync({ root });
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');

    expect(result.stderr).toContain('replaced  AGENTS.md (Atlas block)');
    expect(text).toContain('<!-- vulcan:atlas:start');
    expect(text).toContain('acme (this repository), ignis');
    expect(text.indexOf('<!-- vulcan:atlas:end')).toBeLessThan(text.indexOf('## Commands'));
  });

  test('it is not tied to Claude: an agent list without claude gets it too', () => {
    const root = project();

    sync({ root, agents: 'none' });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('vulcan:atlas:start');
  });

  test('a project that does not run the atlas server gets no block', () => {
    const root = project({ mcp: false });
    const result = sync({ root });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD);
    expect(result.stderr).not.toContain('Atlas block');
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
      join(root, '.configs/vulcan.config.ts'),
      CONFIG.replace("[{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' }]", '[]'),
    );

    const result = sync({ root });
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');

    expect(result.stderr).toContain('replaced  AGENTS.md (Atlas block)');
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
    const before = await runDoctorNotes({ root });

    expect(before.map(note => note.file)).toContain('AGENTS.md');
    expect(before.find(note => note.file === 'AGENTS.md')?.message).toBe(
      "the Atlas block is missing or out of date - run 'bun x --no-install vulcan sync'",
    );

    sync({ root });

    expect((await runDoctorNotes({ root })).map(note => note.file)).not.toContain('AGENTS.md');
    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('Atlas block');
  });

  test('doctor stays quiet for a project without the atlas server', async () => {
    const root = project({ mcp: false });

    expect((await runDoctorNotes({ root })).map(note => note.file)).not.toContain('AGENTS.md');
  });
});
