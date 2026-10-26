import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBaseRules } from '../../../packages/cli/src/rules/index.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const CLI_BASE = join(ROOT, 'packages', 'cli', 'base');
const WIKI = join(ROOT, 'docs', 'wiki');

const read = (opts: { path: string }): string => readFileSync(join(WIKI, opts.path), 'utf8');

/** What the intro pages count, counted from the shipped files, so a number cannot go stale unnoticed. */
const counts = () => {
  const agents: { id: string }[] = JSON.parse(readFileSync(join(CLI_BASE, 'agents.json'), 'utf8'));

  return {
    rules: Object.keys(readBaseRules()).length,
    skills: readdirSync(join(CLI_BASE, 'skills')).length,
    tools: readdirSync(join(ROOT, 'packages', 'atlas', 'src', 'tools')).filter((file) =>
      file.endsWith('.tool.ts'),
    ).length,
    // Copilot is two entries (CLI and VS Code) and one product.
    agents: new Set(agents.map((agent) => agent.id.split('-')[0])).size,
  };
};

const statOf = (opts: { label: string }): number => {
  const landing = read({ path: 'site/.vitepress/theme/HomeLanding.vue' });
  const match = new RegExp(
    `vu-stat__n vu-gtext">(\\d+)</div>\\s*<div class="vu-stat__l">${opts.label}</div>`,
  ).exec(landing);

  if (match === null) {
    throw new Error(`HomeLanding.vue has no stat labelled "${opts.label}"`);
  }

  return Number(match[1]);
};

// A number on the first screen of the wiki is a claim: it is checked against the code.
describe('the numbers on the intro pages', () => {
  test('the stats of the home page match the shipped files', () => {
    const real = counts();

    expect(statOf({ label: 'base rules' })).toBe(real.rules);
    expect(statOf({ label: 'coding agents' })).toBe(real.agents);
    expect(statOf({ label: 'atlas tools' })).toBe(real.tools);
  });

  test('what-is-vulcan states the same numbers', () => {
    const real = counts();
    const page = read({ path: 'content/guides/get-started/what-is-vulcan.md' });

    expect(page).toContain(`${real.rules} rules in five groups`);
    expect(page).toContain(`${real.skills} workflows`);
    expect(page).toContain(`An MCP server with ${real.tools} tools`);
  });
});
