import { describe, expect, test } from 'bun:test';
import {
  EXCLUDE_BLOCK_END,
  EXCLUDE_BLOCK_START,
  excludePathsOf,
  mergeExcludeBlock,
  renderExcludeBlock,
} from '../../agents/index.ts';

describe('excludePathsOf', () => {
  const SKILLS = ['build-a-feature', 'docs-update', 'docs-writing', 'knowledge-sync'];

  test('always lists the local choice file', () => {
    expect(
      excludePathsOf({ agents: [], skillNames: SKILLS }).flatMap((group) => group.paths),
    ).toEqual(['/.agents/vulcan.local.json']);
  });

  test('claude: the shim and the folder', () => {
    const groups = excludePathsOf({ agents: ['claude'], skillNames: SKILLS });

    expect(groups.find((group) => group.title === 'claude')?.paths).toEqual([
      '/CLAUDE.md',
      '/.claude/',
      '/.mcp.json',
    ]);
  });

  test('agents with a project MCP file list it; the agents of the shared one list the root .mcp.json', () => {
    const paths = (agent: string): string[] =>
      excludePathsOf({ agents: [agent], skillNames: SKILLS }).find((group) => group.title === agent)
        ?.paths ?? [];

    expect(paths('cursor')).toContain('/.cursor/mcp.json');
    expect(paths('codex')).toContain('/.codex/config.toml');
    expect(paths('copilot-vscode')).toContain('/.vscode/mcp.json');
    expect(paths('antigravity')).toContain('/.agents/mcp_config.json');
    expect(paths('pi')).toContain('/.pi/mcp.json');
    expect(paths('omp')).toContain('/.mcp.json');
    expect(paths('copilot-cli')).toContain('/.mcp.json');
  });

  test('the root .mcp.json is listed once, under the first agent that reads it', () => {
    const groups = excludePathsOf({ agents: ['claude', 'omp', 'copilot-cli'], skillNames: SKILLS });
    const all = groups.flatMap((group) => group.paths);

    expect(all.filter((path) => path === '/.mcp.json')).toHaveLength(1);
    expect(groups.find((group) => group.title === 'claude')?.paths).toContain('/.mcp.json');
    expect(groups.find((group) => group.title === 'omp')?.paths).not.toContain('/.mcp.json');
  });

  test('an agent that does not read it lists no .mcp.json', () => {
    const all = excludePathsOf({ agents: ['cursor', 'pi'], skillNames: SKILLS }).flatMap(
      (group) => group.paths,
    );

    expect(all).not.toContain('/.mcp.json');
  });

  test('every agent except claude lists the shipped-skill links of .agents/skills', () => {
    const omp = excludePathsOf({ agents: ['omp'], skillNames: SKILLS }).find(
      (group) => group.title === 'omp',
    );

    expect(omp?.paths).toEqual([
      '/.mcp.json',
      '/.agents/skills/build-a-feature',
      '/.agents/skills/docs-update',
      '/.agents/skills/docs-writing',
      '/.agents/skills/knowledge-sync',
    ]);
  });

  test('agents that share the skills folder list its links once', () => {
    const all = excludePathsOf({ agents: ['omp', 'codex', 'pi'], skillNames: SKILLS }).flatMap(
      (group) => group.paths,
    );

    expect(all.filter((path) => path === '/.agents/skills/docs-update')).toHaveLength(1);
  });

  test('an agent that is not chosen lists nothing', () => {
    const titles = excludePathsOf({ agents: ['omp'], skillNames: SKILLS }).map(
      (group) => group.title,
    );

    expect(titles).not.toContain('cursor');
    expect(titles).not.toContain('claude');
  });
});

describe('renderExcludeBlock', () => {
  test('one comment line per agent, then its anchored paths, between the markers', () => {
    const block = renderExcludeBlock({
      groups: [
        { title: 'cursor', paths: ['/.cursor/mcp.json'] },
        { title: 'local', paths: ['/.agents/vulcan.local.json'] },
      ],
    });

    expect(block).toBe(
      [
        EXCLUDE_BLOCK_START,
        '# cursor',
        '/.cursor/mcp.json',
        '# local',
        '/.agents/vulcan.local.json',
        EXCLUDE_BLOCK_END,
        '',
      ].join('\n'),
    );
    expect(EXCLUDE_BLOCK_START).toBe(
      '# vulcan:start - written by vulcan sync for the agents you chose; do not edit',
    );
    expect(EXCLUDE_BLOCK_END).toBe('# vulcan:end');
  });
});

describe('mergeExcludeBlock', () => {
  const block = renderExcludeBlock({ groups: [{ title: 'cursor', paths: ['/.cursor/mcp.json'] }] });

  test('no file yet: only the block', () => {
    expect(mergeExcludeBlock({ text: undefined, block })).toEqual({ changed: true, text: block });
  });

  test("the user's own lines stay and the block comes after a blank line", () => {
    const before = '# mine\n*.log\n';

    expect(mergeExcludeBlock({ text: before, block })).toEqual({
      changed: true,
      text: `${before}\n${block}`,
    });
  });

  test('the same block again changes nothing', () => {
    expect(mergeExcludeBlock({ text: block, block })).toEqual({ changed: false, text: block });
  });

  test('a changed block is replaced between its markers, the lines around it untouched', () => {
    const other = renderExcludeBlock({ groups: [{ title: 'pi', paths: ['/.pi/mcp.json'] }] });
    const before = `*.log\n\n${block}\nafter\n`;
    const merged = mergeExcludeBlock({ text: before, block: other });

    expect(merged).toEqual({ changed: true, text: `*.log\n\n${other}\nafter\n` });
    expect(merged.text).not.toContain('cursor');
  });

  test('a project below the top level has a block of its own: merging it leaves the top level block alone', () => {
    const root = renderExcludeBlock({ groups: [{ title: 'claude', paths: ['/.mcp.json'] }] });
    const nested = renderExcludeBlock({
      groups: [{ title: 'claude', paths: ['/apps/web/.mcp.json'] }],
      prefix: 'apps/web/',
    });
    const merged = mergeExcludeBlock({ text: root, block: nested, prefix: 'apps/web/' });

    expect(nested.split('\n')[0]).toContain('(apps/web/)');
    expect(merged.text).toContain(root);
    expect(merged.text).toContain('/apps/web/.mcp.json');
    expect(merged.text.match(/# vulcan:end/g)).toHaveLength(2);
  });

  test('the top level block is replaced without touching a nested one, and the other way round', () => {
    const nested = renderExcludeBlock({
      groups: [{ title: 'claude', paths: ['/apps/web/.mcp.json'] }],
      prefix: 'apps/web/',
    });
    const before = `${block}\n${nested}`;
    const rootAgain = renderExcludeBlock({ groups: [{ title: 'pi', paths: ['/.pi/mcp.json'] }] });
    const nestedAgain = renderExcludeBlock({
      groups: [{ title: 'pi', paths: ['/apps/web/.pi/mcp.json'] }],
      prefix: 'apps/web/',
    });
    const afterRoot = mergeExcludeBlock({ text: before, block: rootAgain });

    expect(afterRoot.text).toContain('/apps/web/.mcp.json');
    expect(afterRoot.text).not.toContain('cursor');

    const afterNested = mergeExcludeBlock({
      text: afterRoot.text,
      block: nestedAgain,
      prefix: 'apps/web/',
    });

    expect(afterNested.text).toContain('/.pi/mcp.json');
    expect(afterNested.text).toContain('/apps/web/.pi/mcp.json');
    expect(afterNested.text).not.toContain('/apps/web/.mcp.json');
  });

  test('the same nested block again changes nothing', () => {
    const nested = renderExcludeBlock({
      groups: [{ title: 'claude', paths: ['/apps/web/.mcp.json'] }],
      prefix: 'apps/web/',
    });

    expect(mergeExcludeBlock({ text: nested, block: nested, prefix: 'apps/web/' }).changed).toBe(
      false,
    );
  });

  test('a block with no end marker never swallows the block that follows it', () => {
    const nested = renderExcludeBlock({
      groups: [{ title: 'claude', paths: ['/apps/web/.mcp.json'] }],
      prefix: 'apps/web/',
    });
    const dangling = nested.replace('# vulcan:end\n', '');
    const before = `${dangling}${block}`;
    const merged = mergeExcludeBlock({ text: before, block: nested, prefix: 'apps/web/' });

    expect(merged.text).toContain(block);
    expect(merged.text).toContain('/.cursor/mcp.json');
  });
});
