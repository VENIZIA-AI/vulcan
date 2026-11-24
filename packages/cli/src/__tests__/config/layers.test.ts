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

  test('an array that is not one of the six is replaced by the later layer, never added to or deduplicated', () => {
    expect(
      ConfigLayers.merge({
        layers: [
          layer('base', {
            packages: [{ dir: 'x', name: 'x' }],
            claude: { settings: { hooks: { Stop: ['a'] } } },
          }),
          layer('project', { packages: [], claude: { settings: { hooks: { Stop: ['b', 'b'] } } } }),
        ],
      }).value,
    ).toEqual({ packages: [], claude: { settings: { hooks: { Stop: ['b', 'b'] } } } });
  });

  test('duplicates inside one layer are kept, and only the earlier layers are compared', () => {
    const { value } = ConfigLayers.merge({
      layers: [
        layer('base', { digest: { oftenDropped: ['V-P-07'] }, atlas: { sources: [source('a')] } }),
        layer('project', {
          digest: { oftenDropped: ['V-P-07', 'V-B-03', 'V-B-03'] },
          atlas: {
            sources: [
              { name: 'a', repo: 'mine/a' },
              { name: 'a', repo: 'mine/a2' },
            ],
          },
        }),
      ],
    });

    expect(value).toEqual({
      digest: { oftenDropped: ['V-P-07', 'V-B-03', 'V-B-03'] },
      atlas: {
        sources: [
          { name: 'a', repo: 'mine/a' },
          { name: 'a', repo: 'mine/a2' },
        ],
      },
    });
  });

  test('only plain objects are merged into: a key named __proto__ stays a key, and a Date or a class instance is a value', () => {
    const hostile = JSON.parse('{"name":"acme","__proto__":{"polluted":true}}');
    const { value } = ConfigLayers.merge({ layers: [layer('project', hostile)] });

    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(VULCAN_CONFIG_SCHEMA.safeParse(value).success).toBe(false);

    const when = new Date(0);

    expect(
      ConfigLayers.merge({
        layers: [layer('base', { a: { b: 1 } }), layer('project', { a: when })],
      }).value,
    ).toEqual({ a: when });
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
        privateValues: { acknowledged: [{ path: 'a/**', kinds: ['token', 'ipv4'], reason: 'r' }] },
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
    expect(ConfigLayers.checkShipped({ value })).toContain(word);
  });

  test('a value that is not an object, and the keys a shipped layer may set, are checked', () => {
    expect(ConfigLayers.checkShipped({ value: [] })).toContain('must be an object');
    expect(
      ConfigLayers.checkShipped({
        value: { digest: { oftenDropped: ['V-P-07'] }, presets: [] },
      }),
    ).toBeUndefined();
  });
});

describe('the merge and the schema', () => {
  test('a pack layer gives the project values it did not write, and the schema checks the merge', () => {
    const { value, from } = ConfigLayers.merge({
      layers: [
        layer('pack venizia', { atlas: { sources: [source('ignis'), source('ardor')] } }),
        layer('project', { name: 'acme' }),
      ],
      remove: { 'atlas.sources': ['ardor'] },
    });
    const parsed = VULCAN_CONFIG_SCHEMA.parse(value);

    expect(parsed.name).toBe('acme');
    expect(parsed.atlas.sources.map((entry) => entry.name)).toEqual(['ignis']);
    expect(from['atlas.sources[ignis]']).toBe('pack venizia');
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

  test('the shipped layers are the base and each pack in order, under the project object', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': "export default { name: 'acme', packs: ['venizia'] };\n",
      },
    });
    const loaded = await ConfigLoader.load({ root });

    expect(loaded.ok).toBe(true);
    expect(loaded.ok ? loaded.layers.project : undefined).toEqual({
      name: 'acme',
      packs: ['venizia'],
    });
    expect(loaded.ok ? loaded.layers.below.map((entry) => entry.name) : []).toEqual([
      'base',
      'pack venizia',
    ]);
  });
});

describe('a project object alone, through the merge, is exactly what the schema gives it directly', () => {
  const duplicate = { name: 'acme', repo: 'o/a' };
  const configs: Record<string, Record<string, unknown>> = {
    'a team app config': {
      name: 'acme',
      project: { key: 'ACME' },
      agents: ['claude'],
      packs: ['venizia'],
      layout: { backend: 'umbras', frontend: ['auroras/apps'], shared: ['shared'] },
      presets: [{ spec: 'ignis', side: 'backend', summary: 'a backend', lib: 'lib' }],
      packages: [
        { dir: 'shared-contracts', name: '@x/contracts', path: 'shared/contracts' },
        { dir: 'umbras-core', name: '@x/core', path: 'umbras/core' },
      ],
      digest: { oftenDropped: ['P-02', 'V-P-07'] },
      atlas: { tagPattern: '<date>_v<version>', sources: [{ name: 'ignis', repo: 'o/ignis' }] },
      claude: {
        settings: {
          enabledPlugins: { 'figma@x': true },
          permissions: { allow: ['Bash(ls:*)', 'Bash(jq:*)'], deny: ['Bash(git push:*)'] },
        },
      },
      doctor: {
        privateValues: {
          acknowledged: [
            { path: 'a/**', kinds: ['ipv4'], reason: 'one' },
            { path: 'a/**', kinds: ['token'], reason: 'two' },
          ],
        },
      },
      events: { log: true },
    },
    'duplicate arrays, hooks and atlas sources': {
      digest: { oftenDropped: ['V-P-07', 'V-P-07'] },
      presets: [
        { spec: 'ignis', side: 'backend', summary: 'first' },
        { spec: 'ignis', side: 'backend', summary: 'second' },
      ],
      atlas: { sources: [{ ...duplicate }, { name: 'a', repo: 'o/b' }] },
      claude: {
        settings: {
          hooks: {
            Stop: [
              { hooks: [{ type: 'command', command: 'x' }] },
              { hooks: [{ type: 'command', command: 'x' }] },
            ],
          },
          permissions: { allow: ['Bash(ls:*)', 'Bash(ls:*)'] },
        },
      },
    },
    'an empty config': {},
  };

  test.each(Object.keys(configs))('%s parses to the same config as without layers', (label) => {
    const project = configs[label] ?? {};
    const { value } = ConfigLayers.merge({ layers: [layer('project', project)] });

    expect(VULCAN_CONFIG_SCHEMA.parse(value)).toEqual(VULCAN_CONFIG_SCHEMA.parse(project));
  });
});

describe('a broken shipped layer', () => {
  test('is named by its own file with the real problem, and the session note does not send the user to upgrade', () => {
    const note = ConfigLoader.unreadableNote({
      loaded: {
        ok: false,
        file: '/p/.configs/vulcan.config.mts',
        error:
          'base/packs/venizia.config.json: invalid shipped config\n  digest.oftenDropped: Invalid input',
      },
    });

    expect(note).toContain('base/packs/venizia.config.json');
    expect(note).toContain('digest.oftenDropped: Invalid input');
    expect(note).not.toContain('vulcan project upgrade');
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
    const result = runCli({ args: ['config', 'effective'], cwd: project() });
    const out = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(out.config.name).toBe('acme');
    expect(out.config.digest.oftenDropped).toHaveLength(11);
    expect(out.from['digest.oftenDropped[V-P-07]']).toBe('base');
    expect(out.from.name).toBe('project');
    expect(out.unmatchedRemove).toEqual(['atlas.sources: ghost']);
  });

  test('--diff says nothing repeats when the project writes none of what the shipped layers give', () => {
    const result = runCli({ args: ['config', 'diff'], cwd: project() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('nothing in the project config equals the shipped defaults');
  });

  test('neither flag, both flags, an extra argument and a config that cannot load are refused', () => {
    const root = project();

    expect(runCli({ args: ['config'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['config', 'effective', '--diff'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['config', 'effective', 'x'], cwd: root }).code).toBe(2);

    const broken = createProject({
      files: { '.configs/vulcan.config.mts': 'export default { nope: 1 };\n' },
    });

    expect(runCli({ args: ['config', 'effective'], cwd: broken }).code).toBe(1);
  });
});
