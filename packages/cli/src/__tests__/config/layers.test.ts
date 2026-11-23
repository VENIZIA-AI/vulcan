import { afterAll, describe, expect, test } from 'bun:test';
import { ConfigLayers, ConfigLoader, VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import type { IConfigLayer } from '../../config/index.ts';
import { RulePacks } from '../../rules/packs.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const layer = (name: string, value: Record<string, unknown>): IConfigLayer => ({ name, value });
const source = (name: string) => ({ name, repo: `org/${name}` });

describe('ConfigLayers.merge: the rules, the same for every key', () => {
  test('objects merge key by key, and the last layer wins a scalar', () => {
    const { value, from } = ConfigLayers.merge({
      layers: [
        layer('base', { guard: { outside: 'ask' }, knowledge: { wiki: 'a' } }),
        layer('pack venizia', { guard: { outside: 'deny' } }),
        layer('project', { knowledge: { wiki: 'b' } }),
      ],
    });

    expect(value).toEqual({ guard: { outside: 'deny' }, knowledge: { wiki: 'b' } });
    expect(from['guard.outside']).toBe('pack venizia');
    expect(from['knowledge.wiki']).toBe('project');
  });

  test('arrays add in layer order, and a string already there is left out', () => {
    const { value, from } = ConfigLayers.merge({
      layers: [
        layer('base', {
          claude: { settings: { permissions: { allow: ['Bash(ls:*)', 'Bash(jq:*)'] } } },
        }),
        layer('pack venizia', {
          claude: { settings: { permissions: { allow: ['Bash(jq:*)', 'Bash(rg:*)'] } } },
        }),
        layer('project', { claude: { settings: { permissions: { allow: ['Bash(date:*)'] } } } }),
      ],
    });

    expect(value).toEqual({
      claude: {
        settings: {
          permissions: { allow: ['Bash(ls:*)', 'Bash(jq:*)', 'Bash(rg:*)', 'Bash(date:*)'] },
        },
      },
    });
    expect(from['claude.settings.permissions.allow[Bash(jq:*)]']).toBe('pack venizia');
  });

  test('an array of objects: the later copy of one identity replaces the earlier in its place', () => {
    const { value } = ConfigLayers.merge({
      layers: [
        layer('pack venizia', { atlas: { sources: [source('ignis'), source('ardor')] } }),
        layer('project', {
          atlas: { sources: [{ name: 'ignis', repo: 'mine/ignis' }, source('vulcan')] },
        }),
      ],
    });

    expect(value).toEqual({
      atlas: {
        sources: [{ name: 'ignis', repo: 'mine/ignis' }, source('ardor'), source('vulcan')],
      },
    });
  });

  test('an acknowledgement is named by its path and its kinds together', () => {
    const { value } = ConfigLayers.merge({
      layers: [
        layer('base', {
          doctor: {
            privateValues: { acknowledged: [{ path: 'a/**', kinds: ['ipv4'], reason: 'one' }] },
          },
        }),
        layer('project', {
          doctor: {
            privateValues: {
              acknowledged: [
                { path: 'a/**', kinds: ['token'], reason: 'two' },
                { path: 'a/**', kinds: ['ipv4'], reason: 'three' },
              ],
            },
          },
        }),
      ],
    });
    const list = (value as { doctor: { privateValues: { acknowledged: { reason: string }[] } } })
      .doctor.privateValues.acknowledged;

    expect(list.map((entry) => entry.reason)).toEqual(['three', 'two']);
  });

  test('packages is the one exception: what the project writes, even [], is the list', () => {
    expect(
      ConfigLayers.merge({
        layers: [
          layer('base', { packages: [{ dir: 'x', name: 'x' }] }),
          layer('project', { packages: [] }),
        ],
      }).value,
    ).toEqual({ packages: [] });
  });

  test('a later layer of a different type replaces the earlier (the schema then says what is wrong)', () => {
    expect(
      ConfigLayers.merge({
        layers: [
          layer('base', { digest: { oftenDropped: ['V-P-07'] } }),
          layer('project', { digest: 'x' }),
        ],
      }).value,
    ).toEqual({ digest: 'x' });
  });
});

describe('ConfigLayers.merge: remove', () => {
  const layers = [
    layer('pack venizia', {
      presets: [
        { spec: 'ignis', side: 'backend', summary: 'a' },
        { spec: 'ardor', side: 'frontend', summary: 'b' },
      ],
      atlas: { sources: [source('ignis'), source('ardor'), source('vulcan')] },
      claude: { settings: { permissions: { allow: ['Bash(ls:*)', 'Bash(ps:*)'] } } },
      doctor: {
        privateValues: { acknowledged: [{ path: 'a/**', kinds: ['ipv4', 'token'], reason: 'r' }] },
      },
    }),
    layer('project', { atlas: { sources: [source('own')] } }),
  ];

  test('takes strings, and objects by identity, out of what every layer added', () => {
    const { value, unmatched } = ConfigLayers.merge({
      layers,
      remove: {
        presets: ['ardor'],
        'atlas.sources': ['vulcan', 'ignis'],
        'claude.settings.permissions.allow': ['Bash(ps:*)'],
        'doctor.privateValues.acknowledged': ['a/**|ipv4,token'],
      },
    });
    const found = value as {
      presets: { spec: string }[];
      atlas: { sources: { name: string }[] };
      claude: { settings: { permissions: { allow: string[] } } };
      doctor: { privateValues: { acknowledged: unknown[] } };
    };

    expect(found.presets.map((preset) => preset.spec)).toEqual(['ignis']);
    expect(found.atlas.sources.map((entry) => entry.name)).toEqual(['ardor', 'own']);
    expect(found.claude.settings.permissions.allow).toEqual(['Bash(ls:*)']);
    expect(found.doctor.privateValues.acknowledged).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  test('an item that is not there, and an array that is not there, are named as unmatched', () => {
    const { unmatched } = ConfigLayers.merge({
      layers,
      remove: { 'atlas.sources': ['nope'], 'claude.settings.permissions.deny': ['Bash(x)'] },
    });

    expect(unmatched).toEqual(['atlas.sources: nope', 'claude.settings.permissions.deny: Bash(x)']);
  });
});

describe('ConfigLayers.redundant: what the project repeats', () => {
  const below = [
    layer('base', {
      guard: { outside: 'deny' },
      claude: { settings: { permissions: { allow: ['Bash(ls:*)'] } } },
    }),
    layer('pack venizia', { atlas: { sources: [source('ignis')] } }),
  ];

  test('lists scalars and array items the layers below already give, and nothing else', () => {
    expect(
      ConfigLayers.redundant({
        below,
        project: {
          guard: { outside: 'deny', writes: { commands: [] } },
          claude: { settings: { permissions: { allow: ['Bash(ls:*)', 'Bash(mine:*)'] } } },
          atlas: { sources: [source('ignis'), { name: 'ignis2', repo: 'x/y' }] },
          name: 'acme',
        },
      }).sort(),
    ).toEqual([
      'atlas.sources[ignis]',
      'claude.settings.permissions.allow[Bash(ls:*)]',
      'guard.outside',
    ]);
  });

  test('a value that differs from the layer below is not redundant', () => {
    expect(
      ConfigLayers.redundant({
        below,
        project: {
          guard: { outside: 'ask' },
          atlas: { sources: [{ name: 'ignis', repo: 'other/ignis' }] },
        },
      }),
    ).toEqual([]);
  });
});

describe('the shipped layers', () => {
  test('the defaults and every pack with config are valid, and a pack without a file has none', () => {
    const { layers, problems } = ConfigLayers.shipped({ packs: RulePacks.names() });

    expect(problems).toEqual([]);
    expect(layers.map((entry) => entry.name)).toEqual([
      'base',
      ...RulePacks.names().map((name) => `pack ${name}`),
    ]);
    expect(ConfigLayers.shipped({ packs: ['nope'] }).layers.map((entry) => entry.name)).toEqual([
      'base',
    ]);
  });

  test.each([
    [{ name: 'x' }, 'cannot be set by shipped defaults'],
    [{ layout: { backend: 'a' } }, 'layout'],
    [{ digest: { oftenDropped: 'V-P-07' } }, 'digest'],
    [{ guard: { outside: 'maybe' } }, 'guard'],
    [{ atlas: { sources: [{ name: 'a' }] } }, 'atlas'],
  ])('%j is refused by name', (value, word) => {
    expect(ConfigLayers.checkShipped({ name: 'pack x', value })).toContain(word);
  });

  test('a value that is not an object, and the keys a shipped layer may set, are checked', () => {
    expect(ConfigLayers.checkShipped({ name: 'base', value: [] })).toContain('must be an object');
    expect(
      ConfigLayers.checkShipped({
        name: 'base',
        value: { digest: { oftenDropped: ['V-P-07'] }, presets: [] },
      }),
    ).toBeUndefined();
  });
});

describe('ConfigLoader.layered and the schema', () => {
  test('a pack layer gives the project values it did not write, and the schema checks the merge', () => {
    const { merge } = ConfigLoader.layered({
      project: { name: 'acme', remove: { 'atlas.sources': ['ardor'] } },
      layers: [layer('pack venizia', { atlas: { sources: [source('ignis'), source('ardor')] } })],
    });
    const parsed = VULCAN_CONFIG_SCHEMA.parse(merge.value);

    expect(parsed.name).toBe('acme');
    expect(parsed.atlas.sources.map((entry) => entry.name)).toEqual(['ignis']);
    expect(merge.from['atlas.sources[ignis]']).toBe('pack venizia');
  });

  test('remove accepts only the arrays shipped defaults can add to, with string items', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ remove: { 'atlas.sources': ['a'] } }).success).toBe(
      true,
    );
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ remove: { name: ['a'] } }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ remove: { 'atlas.sources': 'a' } }).success).toBe(
      false,
    );
  });

  test('with the shipped layers empty, the merge is the project config and nothing else', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': "export default { name: 'acme', packs: ['venizia'] };\n",
      },
    });
    const loaded = await ConfigLoader.load({ root });

    expect(loaded.ok).toBe(true);
    expect(loaded.ok ? loaded.layers.merge.value : undefined).toEqual({
      name: 'acme',
      packs: ['venizia'],
    });
    expect(loaded.ok ? loaded.layers.below.map((entry) => entry.name) : []).toEqual([
      'base',
      'pack venizia',
    ]);
  });
});

describe('vulcan config', () => {
  const project = () =>
    createProject({
      files: {
        '.configs/vulcan.config.mts':
          "export default { name: 'acme', packs: ['venizia'], remove: { 'atlas.sources': ['ghost'] } };\n",
      },
    });

  test('--effective prints the config, where each value came from, and the remove entries that matched nothing', () => {
    const result = runCli({ args: ['config', '--effective'], cwd: project() });
    const out = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(out.config.name).toBe('acme');
    expect(out.config.digest.oftenDropped.length).toBeGreaterThan(0);
    expect(out.from.name).toBe('project');
    expect(out.unmatchedRemove).toEqual(['atlas.sources: ghost']);
  });

  test('--diff says nothing repeats while the shipped layers are empty', () => {
    const result = runCli({ args: ['config', '--diff'], cwd: project() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('nothing in the project config equals the shipped defaults');
  });

  test('neither flag, both flags, an extra argument and a config that cannot load are refused', () => {
    const root = project();

    expect(runCli({ args: ['config'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['config', '--effective', '--diff'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['config', '--effective', 'x'], cwd: root }).code).toBe(2);

    const broken = createProject({
      files: { '.configs/vulcan.config.mts': 'export default { nope: 1 };\n' },
    });

    expect(runCli({ args: ['config', '--effective'], cwd: broken }).code).toBe(1);
  });
});
