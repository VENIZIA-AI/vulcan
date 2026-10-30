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
  packages: opts.packages.map((name) => ({
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
  const leadOf = (opts: { text: string }): string => opts.text.split('\n\n')[0] ?? '';

  test('a repository alone still gets instructions: the corpus, the rule and the three triggers in one lead', () => {
    const lead = leadOf({ text: instructionsOf({ sources: [acme], unavailable: [] }) });

    expect(lead).toContain('Atlas holds the real code and docs of acme (this repository).');
    expect(lead).toContain('Do not answer facts about acme from memory when atlas can answer them');
    expect(lead).toContain('call `symbol` for each export before you write code that imports');
    expect(lead).toContain('`search` then `get` when the user asks how something works');
    expect(lead).toContain('`version` or `changes` for a release or an upgrade');
    expect(lead).toContain('`presets` before you create an app or package');
  });

  test('every source is a corpus, and the package scopes name what counts as its code', () => {
    const lead = leadOf({ text: instructionsOf({ sources: [acme, ignis], unavailable: [] }) });

    expect(lead).toContain(
      'Atlas holds the real code and docs of acme (this repository) and ignis.',
    );
    expect(lead).toContain('`@acme/*`, `@venizia/*`');
  });

  test('how each source was reached is still said, after the lead', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });

    expect(text).toContain('\n\nAtlas serves 2 source(s); every hit names its source.\n');
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
    expect(leadOf({ text })).toContain('docs of acme (this repository).');
    expect(leadOf({ text })).not.toContain('ardor');
  });

  test('the lead alone is at most 512 characters, up to four corpora, so a client that keeps 512 still gets it all (the fourth trigger, presets, included)', () => {
    const four = [
      repositoryOf({ name: 'forge', packages: ['@forge/core', '@forge/web', 'forge-cli'] }),
      remoteOf({ name: 'anvil', packages: ['@anvil/kernel', '@anvil/boot'] }),
      remoteOf({ name: 'bellows', packages: ['@bellows/air', '@bellows/fan'] }),
      remoteOf({ name: 'tongs', packages: ['@tongs/grip'] }),
    ];
    const lead = leadOf({ text: instructionsOf({ sources: four, unavailable: [] }) });

    expect(lead.length).toBeLessThanOrEqual(512);
    expect(lead).toContain('`symbol`');
    expect(lead).toContain('`search`');
    expect(lead).toContain('`version`');
    expect(lead).toContain('from memory');
  });

  test('more than four corpora are shortened to "and N more" so the lead still fits', () => {
    const many = ['forge', 'anvil', 'bellows', 'tongs', 'quench', 'temper'].map((name) =>
      remoteOf({ name, packages: [`@${name}/pkg`] }),
    );
    const lead = leadOf({ text: instructionsOf({ sources: many, unavailable: [] }) });

    expect(lead.length).toBeLessThanOrEqual(512);
    expect(lead).toContain('and 2 more');
  });

  test('the whole text stays under 2048 bytes, status lines included', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2048);
  });

  test('four corpora, one of them unreachable, still fit 2048 bytes with the second paragraph', () => {
    const four = [
      acme,
      remoteOf({ name: 'anvil', packages: ['@anvil/kernel', '@anvil/boot'] }),
      remoteOf({ name: 'bellows', packages: ['@bellows/air'] }),
      remoteOf({ name: 'tongs', packages: ['@tongs/grip'] }),
    ];
    const text = instructionsOf({
      sources: four,
      unavailable: [
        {
          source: { name: 'ardor', repo: 'VENIZIA-AI/ardor', ref: 'develop' },
          reason: 'the remote was unreachable',
        },
      ],
    });

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2048);
  });

  test('a second paragraph says a how-to-build question must search first, and a plan must call before it says check atlas', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });
    const second = text.split('\n\n')[1] ?? '';

    expect(second).toBe(
      'Before you answer how to build something in acme and ignis (a feature, a controller, a service, a repository, a datasource) or how a convention is organised, call `search` and read the hits with `get`; do not answer from the files you happen to open. A plan never says "check atlas" for a step you have not done: call it first.',
    );
  });

  test('the lead keeps to 512 characters: the second paragraph is not part of it', () => {
    const text = instructionsOf({ sources: [acme, ignis], unavailable: [] });

    expect(leadOf({ text }).length).toBeLessThanOrEqual(512);
    expect(leadOf({ text })).not.toContain('files you happen to open');
  });
});

describe('skills in the instructions', () => {
  const acme = repositoryOf({ name: 'acme', packages: ['@acme/core'] });
  const skills = [
    {
      name: 'build-a-feature',
      trigger:
        'the user asks to build, add or implement something, asks how a feature would be built here, or asks which skill or workflow you follow for a feature',
    },
    { name: 'docs-update', trigger: 'the user asks to update the wiki or the docs' },
  ];

  test('one line per skill, name and trigger, after the second paragraph and before the status lines', () => {
    const text = instructionsOf({ sources: [acme], unavailable: [], skills });
    const paragraphs = text.split('\n\n');

    expect(paragraphs[2]).toBe(
      [
        'Skills: a request matches one, load it before you answer. A workflow question counts.',
        '- `build-a-feature`: the user asks to build, add or implement something, asks how a feature would be built here',
        '- `docs-update`: the user asks to update the wiki or the docs',
      ].join('\n'),
    );
    expect(paragraphs[3]).toContain('Atlas serves 1 source(s)');
  });

  test('a long trigger is cut at a comma or a word, never mid-word, at 110 characters', () => {
    const text = instructionsOf({ sources: [acme], unavailable: [], skills });
    const line = text.split('\n').find((row) => row.startsWith('- `build-a-feature`')) ?? '';

    expect(line.length).toBeLessThanOrEqual('- `build-a-feature`: '.length + 110);
    expect(line.endsWith(',')).toBe(false);
  });

  test('no skills, no section', () => {
    expect(instructionsOf({ sources: [acme], unavailable: [] })).not.toContain('Skills:');
    expect(instructionsOf({ sources: [acme], unavailable: [], skills: [] })).not.toContain(
      'Skills:',
    );
  });

  test('four corpora, one unreachable, and four skills still fit 2048 bytes', () => {
    const four = [
      acme,
      remoteOf({ name: 'anvil', packages: ['@anvil/kernel', '@anvil/boot'] }),
      remoteOf({ name: 'bellows', packages: ['@bellows/air'] }),
      remoteOf({ name: 'tongs', packages: ['@tongs/grip'] }),
    ];
    const four4 = [
      ...skills,
      {
        name: 'docs-writing',
        trigger:
          'you write or edit anything a human will read - wiki pages, READMEs, changelogs, references',
      },
      {
        name: 'knowledge-sync',
        trigger:
          'the user asks to sync knowledge, refresh the knowledge bundle, audit concepts against code',
      },
    ];
    const text = instructionsOf({
      sources: four,
      unavailable: [
        {
          source: { name: 'ardor', repo: 'VENIZIA-AI/ardor', ref: 'develop' },
          reason: 'the remote was unreachable',
        },
      ],
      skills: four4,
    });

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2048);
  });
});

describe('a server built from a project', () => {
  const call = async (opts: { method: string }) => {
    const transport = buildServer({ root: ACME, version: '0.0.0' });

    const result = await transport.handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: opts.method, params: {} }),
    });
    return JSON.parse(result ?? 'null');
  };

  test('initialize carries the instructions', async () => {
    const reply = await call({ method: 'initialize' });

    expect(reply.result.instructions).toContain('acme (this repository)');
    expect(reply.result.instructions).toContain('from memory');
  });

  test('every tool description names the project', async () => {
    const reply = await call({ method: 'tools/list' });
    const names = reply.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual(['search', 'get', 'symbol', 'version', 'changes', 'presets']);

    for (const tool of reply.result.tools as { name: string; description: string }[]) {
      if (tool.name !== 'get') {
        expect(tool.description).toContain('acme');
      }
    }
  });
});
