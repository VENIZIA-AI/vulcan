import { describe, expect, test } from 'bun:test';
import { AGENT_ENTRY_SCHEMA, readAgentTable } from '../../agents/index.ts';
import { CodingAgents } from '../../config/index.ts';

const SEVEN_AGENTS = [
  'claude',
  'omp',
  'codex',
  'cursor',
  'copilot-cli',
  'copilot-vscode',
  'antigravity',
  'pi',
];

const VALID_ENTRY = {
  id: 'demo',
  name: 'Demo',
  detect: { binaries: ['demo'], homeDirs: ['~/.demo'], projectDirs: ['.demo'] },
  instructions: { nativeAgentsMd: true, shim: null },
  mcp: { scope: 'project', path: '.demo/mcp.json', renderer: 'mcpServers' },
  skills: { dir: '.agents/skills' },
  instructionsSurfaced: null,
  notes: [],
};

describe('the shipped agent table', () => {
  const table = readAgentTable();

  test('holds exactly the seven agents Phat named, Copilot being two products', () => {
    expect(table.map((entry) => entry.id)).toEqual(SEVEN_AGENTS);
    expect(new Set(table.map((entry) => entry.id)).size).toBe(table.length);
  });

  test('the ids are the ones a config may name', () => {
    expect([...CodingAgents.SCHEME_SET]).toEqual(SEVEN_AGENTS);
  });

  test('only Claude needs a shim, and it imports AGENTS.md', () => {
    const shims = table.filter((entry) => entry.instructions.shim !== null);

    expect(shims.map((entry) => entry.id)).toEqual(['claude']);
    expect(shims[0]?.instructions.shim).toEqual({ path: 'CLAUDE.md', content: '@AGENTS.md' });
  });

  test('omp, Copilot CLI and Claude share the committed root .mcp.json; the others write their own file', () => {
    const shared = table.filter((entry) => entry.mcp.scope === 'shared').map((entry) => entry.id);

    expect(shared).toEqual(['claude', 'omp', 'copilot-cli']);

    for (const entry of table.filter((item) => item.mcp.scope === 'shared')) {
      expect(entry.mcp.path).toBe('.mcp.json');
    }

    expect(Object.fromEntries(table.map((entry) => [entry.id, entry.mcp.path]))).toMatchObject({
      codex: '.codex/config.toml',
      cursor: '.cursor/mcp.json',
      'copilot-vscode': '.vscode/mcp.json',
      antigravity: '.agents/mcp_config.json',
      pi: '.pi/mcp.json',
    });
  });

  test('the renderers follow the file formats: VS Code servers, Codex TOML, mcpServers elsewhere', () => {
    const renderers = Object.fromEntries(table.map((entry) => [entry.id, entry.mcp.renderer]));

    expect(renderers['copilot-vscode']).toBe('servers');
    expect(renderers.codex).toBe('codex-toml');
    expect(renderers.cursor).toBe('mcpServers');
    expect(renderers.antigravity).toBe('mcpServers');
    expect(renderers.pi).toBe('mcpServers');
  });

  test('Claude keeps .claude/skills, every other agent reads .agents/skills', () => {
    for (const entry of table) {
      expect(entry.skills.dir).toBe(entry.id === 'claude' ? '.claude/skills' : '.agents/skills');
    }
  });

  test('what was measured is recorded: omp shows the instructions, Antigravity does not, Pi only a line', () => {
    const surfaced = Object.fromEntries(
      table.map((entry) => [entry.id, entry.instructionsSurfaced]),
    );

    expect(surfaced.claude).toBe(true);
    expect(surfaced.omp).toBe(true);
    expect(surfaced.antigravity).toBe(false);
    expect(surfaced.pi).toBe('partial');
  });

  test('Codex and Pi tell the user to trust the project', () => {
    for (const id of ['codex', 'pi']) {
      expect(table.find((entry) => entry.id === id)?.notes.join(' ')).toContain('trust');
    }
  });
});

describe('the entry schema', () => {
  test('accepts a complete entry', () => {
    expect(AGENT_ENTRY_SCHEMA.safeParse(VALID_ENTRY).success).toBe(true);
  });

  test('a user-level scope is not implemented, so it is refused', () => {
    const entry = { ...VALID_ENTRY, mcp: { ...VALID_ENTRY.mcp, scope: 'user' } };

    expect(AGENT_ENTRY_SCHEMA.safeParse(entry).success).toBe(false);
  });

  test('an unknown renderer, a missing field and an unknown key are refused', () => {
    const renderer = { ...VALID_ENTRY, mcp: { ...VALID_ENTRY.mcp, renderer: 'toml' } };
    const missing = Object.fromEntries(
      Object.entries(VALID_ENTRY).filter(([key]) => key !== 'skills'),
    );

    expect(AGENT_ENTRY_SCHEMA.safeParse(renderer).success).toBe(false);
    expect(AGENT_ENTRY_SCHEMA.safeParse(missing).success).toBe(false);
    expect(AGENT_ENTRY_SCHEMA.safeParse({ ...VALID_ENTRY, extra: 1 }).success).toBe(false);
  });

  test('a shared entry must point at the root .mcp.json', () => {
    const entry = {
      ...VALID_ENTRY,
      mcp: { scope: 'shared', path: '.omp/mcp.json', renderer: 'mcpServers' },
    };

    expect(AGENT_ENTRY_SCHEMA.safeParse(entry).success).toBe(false);
  });
});
