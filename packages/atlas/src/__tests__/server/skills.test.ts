import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from '@/server';
import { skillCatalogOf, triggerOf } from '@/skills';
import { makeTempDirectory, TEMP_DIRECTORIES } from '../sources/source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const skill = (opts: { name: string; description: string }): string =>
  `---\nname: ${opts.name}\ndescription: ${opts.description}\n---\n\n# ${opts.name}\n`;

const write = (opts: { root: string; path: string; text: string }): void => {
  mkdirSync(join(opts.root, opts.path, '..'), { recursive: true });
  writeFileSync(join(opts.root, opts.path), opts.text);
};

const shipped = (opts: { root: string; name: string; description: string }): void =>
  write({
    root: opts.root,
    path: `node_modules/@venizia/vulcan/base/skills/${opts.name}/SKILL.md`,
    text: skill(opts),
  });

const own = (opts: { root: string; name: string; description: string }): void =>
  write({ root: opts.root, path: `.agents/skills/${opts.name}/SKILL.md`, text: skill(opts) });

describe('triggerOf', () => {
  test('is the "Use when" sentence of the description, without its period', () => {
    expect(
      triggerOf({
        description:
          'Builds a feature. Use when the user asks to build, add or implement something, or which workflow you follow. Load it first.',
      }),
    ).toEqual({
      text: 'the user asks to build, add or implement something, or which workflow you follow',
      hasUseWhen: true,
    });
  });

  test('a description with no "Use when" falls back to its first sentence and says so', () => {
    expect(triggerOf({ description: 'Writes the docs. It is careful.' })).toEqual({
      text: 'Writes the docs',
      hasUseWhen: false,
    });
  });

  test('a "Use when" at the end with no period still ends cleanly', () => {
    expect(triggerOf({ description: 'Does a thing. Use when the user says go' }).text).toBe(
      'the user says go',
    );
  });
});

describe('skillCatalogOf', () => {
  test('lists the shipped skills of the installed vulcan and the project own, sorted by name', () => {
    const root = makeTempDirectory({ prefix: 'atlas-skills-' });

    shipped({ root, name: 'docs-update', description: 'Docs. Use when the user asks for docs.' });
    shipped({ root, name: 'build-a-feature', description: 'Builds. Use when the user builds.' });
    own({ root, name: 'acme-release', description: 'Ships. Use when the user ships.' });

    expect(skillCatalogOf({ root }).map(entry => [entry.name, entry.source])).toEqual([
      ['acme-release', 'project'],
      ['build-a-feature', 'shipped'],
      ['docs-update', 'shipped'],
    ]);
  });

  test('a project skill that shadows a shipped name is left out, as sync leaves it out', () => {
    const root = makeTempDirectory({ prefix: 'atlas-skills-' });

    shipped({ root, name: 'docs-update', description: 'Docs. Use when the user asks for docs.' });
    own({ root, name: 'docs-update', description: 'Mine. Use when the user says mine.' });

    expect(skillCatalogOf({ root })).toHaveLength(1);
    expect(skillCatalogOf({ root })[0]?.source).toBe('shipped');
  });

  test('an add, a rename and a delete show on the next call, with no hand edit', () => {
    const root = makeTempDirectory({ prefix: 'atlas-skills-' });

    own({ root, name: 'acme-a', description: 'A. Use when the user wants a.' });
    expect(skillCatalogOf({ root }).map(entry => entry.name)).toEqual(['acme-a']);

    own({ root, name: 'acme-b', description: 'B. Use when the user wants b.' });
    expect(skillCatalogOf({ root }).map(entry => entry.name)).toEqual(['acme-a', 'acme-b']);

    renameSync(join(root, '.agents/skills/acme-a'), join(root, '.agents/skills/acme-c'));
    expect(skillCatalogOf({ root }).map(entry => entry.name)).toEqual(['acme-b', 'acme-c']);

    rmSync(join(root, '.agents/skills/acme-b'), { recursive: true });
    expect(skillCatalogOf({ root }).map(entry => entry.name)).toEqual(['acme-c']);
  });

  test('a folder with no SKILL.md is not a skill, and no vulcan installed is no shipped skill', () => {
    const root = makeTempDirectory({ prefix: 'atlas-skills-' });

    mkdirSync(join(root, '.agents/skills/empty'), { recursive: true });

    expect(skillCatalogOf({ root })).toEqual([]);
  });

  test('a SKILL.md whose frontmatter does not parse is listed with an empty description, never a crash', () => {
    const root = makeTempDirectory({ prefix: 'atlas-skills-' });

    write({
      root,
      path: '.agents/skills/acme-broken/SKILL.md',
      text: '---\nname: acme-broken\ndescription: Broken: yes: really\n---\n',
    });

    expect(skillCatalogOf({ root })).toEqual([
      { name: 'acme-broken', source: 'project', description: '' },
    ]);
  });
});

describe('a server lists the skills the project has, read when a client connects', () => {
  const project = (): string => {
    const root = makeTempDirectory({ prefix: 'atlas-skills-server-' });

    write({
      root,
      path: '.agents/vulcan.manifest.json',
      text: JSON.stringify({
        schemaVersion: 1,
        name: 'acme',
        packages: [],
        knowledge: { bundle: '.agents/knowledge' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      }),
    });
    write({
      root,
      path: '.agents/knowledge/index.md',
      text: '---\ntype: Concept\ntitle: Acme\ndescription: Acme.\n---\n\nAcme.\n',
    });

    return root;
  };
  const initialize = async (opts: { transport: ReturnType<typeof buildServer> }) =>
    JSON.parse(
      (await opts.transport.handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })) ?? 'null',
    ).result.instructions as string;

  test('shipped and project-owned, one line each', async () => {
    const root = project();

    shipped({ root, name: 'build-a-feature', description: 'Builds. Use when the user builds.' });
    own({ root, name: 'acme-release', description: 'Ships. Use when the user ships.' });

    const text = await initialize({ transport: buildServer({ root, version: '0.0.0' }) });

    expect(text).toContain('- `acme-release`: the user ships');
    expect(text).toContain('- `build-a-feature`: the user builds');
  });

  test('a skill added after the start is in the next initialize: nothing is edited by hand', async () => {
    const root = project();
    const transport = buildServer({ root, version: '0.0.0' });

    expect(await initialize({ transport })).not.toContain('acme-new');

    own({ root, name: 'acme-new', description: 'New. Use when the user wants new.' });

    expect(await initialize({ transport })).toContain('- `acme-new`: the user wants new');

    rmSync(join(root, '.agents/skills/acme-new'), { recursive: true });

    expect(await initialize({ transport })).not.toContain('acme-new');
  });
});
