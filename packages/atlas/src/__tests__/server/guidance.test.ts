import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildServer } from '@/server';
import { instructionsOf, projectsOf } from '@/server/guidance';
import type { IAtlasProject } from '@/common/project-config';
import type { IResolvedSource } from '@/sources/common';

const ACME = join(__dirname, '..', 'fixtures', 'acme');

const projectOf = (opts: { name: string; packages: string[] }): IAtlasProject => ({
  root: '/work',
  name: opts.name,
  packages: opts.packages.map(name => ({
    dir: name.replace(/^@[^/]+\//, ''),
    name,
    path: `packages/${name}`,
    aliases: [],
    retired: false,
  })),
  tagPattern: 'v{version}',
  ignoreTags: [],
  typescriptFrom: '/work',
  knowledge: { bundle: '/work/.agents/knowledge' },
  sources: [],
});

const repositoryOf = (opts: { name: string; packages: string[] }): IResolvedSource => ({
  name: opts.name,
  root: '/work',
  mode: 'repository',
  project: projectOf(opts),
});

const remoteOf = (opts: { name: string; packages: string[] }): IResolvedSource => ({
  name: opts.name,
  origin: `VENIZIA-AI/${opts.name}@develop`,
  root: '/cache',
  sha: '6974e8ba1234',
  mode: 'cache',
  project: projectOf(opts),
});

const lines = (opts: { text: string | undefined }): string[] => (opts.text ?? '').split('\n');

describe('projectsOf', () => {
  test('one project is its name; two are joined with "and"; three with commas and "and"', () => {
    const acme = repositoryOf({ name: 'acme', packages: ['@acme/core'] });
    const ignis = remoteOf({ name: 'ignis', packages: ['@venizia/ignis'] });
    const ardor = remoteOf({ name: 'ardor', packages: ['@venizia/ardor'] });

    expect(projectsOf({ sources: [acme] })).toBe('acme');
    expect(projectsOf({ sources: [acme, ignis] })).toBe('acme and ignis');
    expect(projectsOf({ sources: [acme, ignis, ardor] })).toBe('acme, ignis and ardor');
  });
});

describe('instructionsOf', () => {
  const acme = repositoryOf({ name: 'acme', packages: ['@acme/core', '@acme/web'] });
  const ignis = remoteOf({ name: 'ignis', packages: ['@venizia/ignis', '@venizia/ignis-boot'] });

  test('a repository alone still gets instructions, naming the project and the three triggers', () => {
    const text = instructionsOf({ sources: [acme], unavailable: [] });

    expect(text).toContain('acme (this repository)');
    expect(text).toContain('call `symbol` for each export you use');
    expect(text).toContain('call `search` first, then `get`');
    expect(text).toContain('call `version` or `changes`');
    expect(text).toContain(
      'Do not answer facts about acme from memory when atlas can answer them.',
    );
  });

  test('every source is a corpus, and the package scopes name what counts as its code', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });

    expect(text).toContain(
      'Atlas holds the real code and docs of acme (this repository) and ignis.',
    );
    expect(text).toContain('`@acme/*`, `@venizia/*`');
  });

  test('how each source was reached is still said', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });

    expect(text).toContain('Atlas serves 2 source(s); every hit names its source.');
    expect(text).toContain('- acme: this repository, live');
    expect(text).toContain('- ignis: VENIZIA-AI/ignis@develop at 6974e8ba');
  });

  test('a source that could not be served is named with its reason, and is not a corpus', () => {
    const text = instructionsOf({
      sources: [acme],
      unavailable: [
        {
          source: { name: 'ardor', repo: 'VENIZIA-AI/ardor', ref: 'develop' },
          reason: 'the remote was unreachable',
        },
      ],
    });

    expect(text).toContain(
      '- ardor: UNAVAILABLE (VENIZIA-AI/ardor@develop) - the remote was unreachable',
    );
    expect(text).toContain('Atlas holds the real code and docs of acme (this repository).');
    expect(text).not.toContain('acme and ardor');
  });

  test('the guidance stays short: the rule and its triggers fit in eight lines', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });
    const guidance = lines({ text }).slice(
      0,
      lines({ text }).indexOf('Atlas serves 2 source(s); every hit names its source.'),
    );

    expect(guidance.filter(line => line.trim() !== '').length).toBeLessThanOrEqual(8);
  });
});

describe('a server built from a project', () => {
  const call = async (opts: { method: string }) => {
    const transport = buildServer({ root: ACME, version: '0.0.0' });

    return JSON.parse(
      (await transport.handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: opts.method, params: {} }),
      })) ?? 'null',
    );
  };

  test('initialize carries the instructions', async () => {
    const reply = await call({ method: 'initialize' });

    expect(reply.result.instructions).toContain('acme (this repository)');
    expect(reply.result.instructions).toContain('from memory');
  });

  test('every tool description names the project', async () => {
    const reply = await call({ method: 'tools/list' });
    const names = reply.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual(['search', 'get', 'symbol', 'version', 'changes']);

    for (const tool of reply.result.tools as { name: string; description: string }[]) {
      if (tool.name !== 'get') {
        expect(tool.description).toContain('acme');
      }
    }
  });
});
