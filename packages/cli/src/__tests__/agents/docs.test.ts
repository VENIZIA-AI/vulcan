import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAgentTable } from '../../agents/index.ts';

const PAGE = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs/wiki/content/references/agents.md',
);
const page = readFileSync(PAGE, 'utf8');
const rowOf = (opts: { id: string }): string =>
  page.split('\n').find(line => line.startsWith(`| \`${opts.id}\` |`)) ?? '';

// The page is written by hand but checked against the table, so it cannot drift from what sync does.
describe('references/agents.md follows base/agents.json', () => {
  for (const entry of readAgentTable()) {
    test(`${entry.id}: its row names the MCP file, the scope and the skills folder`, () => {
      const row = rowOf({ id: entry.id });

      expect(row).not.toBe('');
      expect(row).toContain(entry.name);
      expect(row).toContain(
        entry.mcp.scope === 'shared' ? '`.mcp.json` (shared)' : `\`${entry.mcp.path}\``,
      );
      expect(row).toContain(`\`${entry.skills.dir}\``);
    });
  }

  test('the instructions column says what was measured', () => {
    expect(rowOf({ id: 'claude' })).toContain('shown');
    expect(rowOf({ id: 'omp' })).toContain('shown');
    expect(rowOf({ id: 'antigravity' })).toContain('not shown');
    expect(rowOf({ id: 'pi' })).toContain('one line');
  });

  test('every note of the table is on the page', () => {
    for (const note of readAgentTable().flatMap(entry => entry.notes)) {
      expect(page).toContain(note);
    }
  });

  test('the page lists no agent that is not in the table', () => {
    const listed = page
      .slice(0, page.indexOf('## What you get'))
      .split('\n')
      .filter(line => /^\| `[a-z-]+` \|/.test(line))
      .map(line => /^\| `([a-z-]+)` \|/.exec(line)?.[1]);

    expect(listed).toEqual(readAgentTable().map(entry => entry.id));
  });
});
