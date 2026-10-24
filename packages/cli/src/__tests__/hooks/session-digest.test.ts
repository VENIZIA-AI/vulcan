import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildSessionDigest } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'session-start.ts');

describe('buildSessionDigest', () => {
  test('the base W rules, the slot choice and the project extensions', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
        '.agents/rules.md':
          '| ID | Rule | Enforced by |\n|---|---|---|\n| W-06 | stay home | SOFT |\n',
      },
    });
    const digest = await buildSessionDigest({ projectRoot: root });

    expect(digest).toContain('| V-W-02 |');
    expect(digest).toContain('| V-W-01 | this project: `read-only`');
    expect(digest).toContain('| W-06 | stay home |');
    expect(digest).toContain('| V-C-02 |');
  });

  // BANA's shape: bold bare IDs define, a V- ID list references the base; a marked minimap block.
  const BANA_RULES = [
    '| ID | Rule | Enforced by |',
    '|---|---|---|',
    '| **W-00** | Never sign a commit as an agent. | SOFT |',
    '| V-W-02, V-W-03 | Ask before psql writes or a deploy, even on develop. | HARD |',
    '',
    '<!-- minimap-shape:start -->',
    'apps/ - one app per directory; libs/ - shared code, no app imports.',
    '<!-- minimap-shape:end -->',
    '',
  ].join('\n');

  test("the often-dropped list comes from the config, and may name the project's own bold rows", async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, digest: { oftenDropped: ['W-00', 'V-P-05'] } };\n",
        '.agents/rules.md': BANA_RULES,
      },
    });
    const digest = await buildSessionDigest({ projectRoot: root });
    const dropped = digest.slice(digest.indexOf('## The rules sessions drop most'));

    expect(dropped).toContain('| **W-00** | Never sign a commit as an agent. |');
    expect(dropped).toContain('| V-P-05 |');
    expect(dropped).not.toContain('| V-C-02 |');
  });

  test("a project's rows that list base IDs are its rules too, and its marked minimap block is printed", async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
        '.agents/rules.md': BANA_RULES,
      },
    });
    const digest = await buildSessionDigest({ projectRoot: root });

    expect(digest).toContain(
      '| V-W-02, V-W-03 | Ask before psql writes or a deploy, even on develop. | HARD |',
    );
    expect(digest).toContain(
      "## This project's minimap\n\napps/ - one app per directory; libs/ - shared code, no app imports.\n",
    );
    expect(digest).not.toContain('minimap-shape:start');
    expect(digest).toContain('| V-C-02 |');
  });

  describe('the Atlas block', () => {
    const ATLAS_MCP = JSON.stringify({
      mcpServers: {
        atlas: { command: 'bun', args: ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp'] },
      },
    });
    const CONFIG = [
      'export default {',
      "  name: 'acme',",
      "  rules: { 'V-W-01': 'on-user-word' },",
      "  atlas: { sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' }, { name: 'ardor', repo: 'VENIZIA-AI/ardor', ref: 'develop' }] },",
      '};',
      '',
    ].join('\n');

    test('lists the corpora from the config and the one-line rule', async () => {
      const root = createProject({
        files: { '.mcp.json': ATLAS_MCP, '.configs/vulcan.config.ts': CONFIG },
      });
      const digest = await buildSessionDigest({ projectRoot: root });
      const block = digest.slice(digest.indexOf('## Atlas'), digest.indexOf('## Write boundaries'));

      expect(block).toContain('acme (this repository), ignis, ardor');
      expect(block).toContain('`symbol` for an export you import');
      expect(block).toContain('`search` for how something works');
      expect(block).toContain('`version` or `changes`');
      expect(block).toContain('V-P-07');
      expect(block.trim().split('\n').length).toBeLessThanOrEqual(5);
    });

    test('a project whose atlas server is not configured gets no block', async () => {
      const root = createProject({ files: { '.configs/vulcan.config.ts': CONFIG } });

      expect(await buildSessionDigest({ projectRoot: root })).not.toContain('## Atlas');
    });

    test('a project with a server but no sources names only itself', async () => {
      const root = createProject({
        files: {
          '.mcp.json': ATLAS_MCP,
          '.configs/vulcan.config.ts':
            "export default { name: 'solo', rules: { 'V-W-01': 'on-user-word' } };\n",
        },
      });
      const digest = await buildSessionDigest({ projectRoot: root });

      expect(digest).toContain('solo (this repository)');
    });

    test('V-P-07 is among the rules sessions drop most', async () => {
      const root = createProject({
        files: { '.mcp.json': ATLAS_MCP, '.configs/vulcan.config.ts': CONFIG },
      });
      const digest = await buildSessionDigest({ projectRoot: root });
      const dropped = digest.slice(digest.indexOf('## The rules sessions drop most'));

      expect(dropped).toContain('| V-P-07 |');
      expect(dropped).toContain('atlas');
    });

    test('the default often-dropped list keeps the original eight rules and adds reuse and the skipped line', async () => {
      const root = createProject({
        files: { '.mcp.json': ATLAS_MCP, '.configs/vulcan.config.ts': CONFIG },
      });
      const digest = await buildSessionDigest({ projectRoot: root });
      const dropped = digest.slice(digest.indexOf('## The rules sessions drop most'));

      for (const id of [
        'V-P-07',
        'V-B-03',
        'V-P-05',
        'V-P-06',
        'V-B-04',
        'V-W-04',
        'V-C-02',
        'V-C-10',
        'V-P-08',
        'V-B-07',
      ]) {
        expect(dropped).toContain(`| ${id} |`);
      }
    });
  });

  test('a project without a config still gets the digest, and sees the slot is not chosen', async () => {
    const digest = await buildSessionDigest({ projectRoot: createProject({ files: {} }) });

    expect(digest).toContain('not chosen');
  });
});

test('the session-start hook prints the digest for CLAUDE_PROJECT_DIR', () => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
    },
  });
  const child = spawnSyncBounded({
    cmd: [process.execPath, HOOK],
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    stdout: 'pipe',
  });

  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString()).toContain('this project: `on-user-word`');
});
