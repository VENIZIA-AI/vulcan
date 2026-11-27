import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigGroups, ConfigLoader } from '../../config/index.ts';
import type { VulcanConfig } from '../../index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

/** The same config in the two shapes: every group, and a key of every section set at least once. */
const FLAT = {
  name: 'demo',
  project: { key: 'DEMO' },
  agents: ['claude', 'omp'],
  rules: { 'V-W-01': 'read-only' },
  packs: ['venizia'],
  layout: { backend: 'apps/backends' },
  presets: [{ spec: 'ignis', side: 'backend', summary: 'an app', lib: 'a lib' }],
  packages: [{ dir: 'api', name: '@acme/api' }],
  knowledge: { bundle: '.agents/knowledge', wiki: 'docs' },
  okf: { brand: 'Demo' },
  atlas: { prebuilt: false, sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis' }] },
  theme: { accent: '#8a5a20', accentDark: '#dead6a' },
  board: { owner: 'Owner', title: 'Demo Board', agents: { 'a-1': 'flame' } },
  provider: { type: 'github' },
  doctor: { privateValues: { acknowledged: [] }, layout: { maxLines: 300 } },
  claude: { settings: { env: {} } },
  digest: { oftenDropped: ['P-09'] },
  owner: { language: 'en' },
  guard: { outside: 'deny' },
  commit: { message: {} },
  events: { log: true, maxFiles: 5 },
  local: { autoClean: false },
  remove: { 'atlas.sources': ['ignis'] },
};

const GROUPED: VulcanConfig.Groups = {
  project: {
    name: 'demo',
    key: 'DEMO',
    layout: FLAT.layout,
    packages: FLAT.packages,
    presets: FLAT.presets as never,
  },
  agent: {
    list: ['claude', 'omp'],
    packs: ['venizia'],
    rules: FLAT.rules as never,
    digest: FLAT.digest,
    owner: FLAT.owner,
    claude: FLAT.claude,
  },
  guard: FLAT.guard as never,
  board: { events: FLAT.events, page: FLAT.board as never, provider: FLAT.provider as never },
  knowledge: { ...FLAT.knowledge, okf: FLAT.okf, atlas: FLAT.atlas as never },
  check: {
    doctor: { privateValues: FLAT.doctor.privateValues },
    commit: FLAT.commit as never,
    layout: FLAT.doctor.layout as never,
  },
  common: { theme: FLAT.theme, local: FLAT.local, remove: FLAT.remove },
};

const write = (opts: { body: string }): string =>
  createProject({ files: { '.configs/vulcan.config.mts': `export default ${opts.body};\n` } });

describe('ConfigGroups.isFlat', () => {
  test('a key that only the flat shape has makes the file flat; board settings of the old page too', () => {
    expect(ConfigGroups.isFlat({ value: { agents: ['claude'] } })).toBe(true);
    expect(ConfigGroups.isFlat({ value: { okf: {} } })).toBe(true);
    expect(ConfigGroups.isFlat({ value: { board: { owner: 'x' } } })).toBe(true);
    expect(ConfigGroups.isFlat({ value: { typo: 1 } })).toBe(true);
  });

  test('a file of group keys is grouped, and so is one with only the keys the two shapes share', () => {
    expect(ConfigGroups.isFlat({ value: { agent: { list: [] }, check: {} } })).toBe(false);
    expect(ConfigGroups.isFlat({ value: { board: { events: { log: true } } } })).toBe(false);
    expect(ConfigGroups.isFlat({ value: { guard: {}, knowledge: { bundle: 'x' } } })).toBe(false);
    expect(ConfigGroups.isFlat({ value: {} })).toBe(false);
  });
});

describe('ConfigGroups.toFlat', () => {
  test('puts every key of every group where the flat shape has it', () => {
    const { flat, issues } = ConfigGroups.toFlat({ value: GROUPED as Record<string, unknown> });

    expect(issues).toEqual([]);
    expect(flat).toEqual(FLAT);
  });

  test('a key a group does not have, or a group that is not an object, is named by its grouped path', () => {
    const { issues } = ConfigGroups.toFlat({
      value: { project: { nme: 'x' }, agent: 'claude', check: { doctor: {}, plural: 1 } },
    });

    expect(issues).toEqual([
      'project.nme: not a key of project (one of name, key, layout, packages, presets)',
      'agent: expected an object',
      'check.plural: not a key of check (one of doctor, commit, layout)',
    ]);
  });

  test('check.layout keeps its place whichever of check.layout and check.doctor comes first', () => {
    const doctorFirst = ConfigGroups.toFlat({
      value: {
        check: { doctor: { privateValues: { acknowledged: [] } }, layout: { maxLines: 9 } },
      },
    });
    const layoutFirst = ConfigGroups.toFlat({
      value: {
        check: { layout: { maxLines: 9 }, doctor: { privateValues: { acknowledged: [] } } },
      },
    });

    expect(doctorFirst.flat).toEqual(layoutFirst.flat);
    expect(doctorFirst.flat['doctor']).toEqual({
      privateValues: { acknowledged: [] },
      layout: { maxLines: 9 },
    });
  });

  test('a group that is undefined is left out, and `packages: undefined` stays a written key', () => {
    const { flat } = ConfigGroups.toFlat({
      value: { agent: undefined, project: { packages: undefined } },
    });

    expect(Object.keys(flat)).toEqual(['packages']);
  });
});

describe('the loader reads either shape and gives the same config', () => {
  test('the grouped file and the flat file of FLAT (read leniently, as `migrate` does) load to the same resolved config', async () => {
    const flat = await ConfigLoader.load({
      root: write({ body: JSON.stringify(FLAT) }),
      isLenient: true,
    });
    const grouped = await ConfigLoader.load({ root: write({ body: JSON.stringify(GROUPED) }) });

    expect(flat.ok, flat.ok ? '' : flat.error).toBe(true);
    expect(grouped.ok, grouped.ok ? '' : grouped.error).toBe(true);
    expect(grouped.ok && flat.ok ? grouped.config : undefined).toEqual(
      flat.ok ? flat.config : undefined,
    );
  });

  test('an empty config, in either shape, is the same defaults', async () => {
    const flat = await ConfigLoader.load({ root: write({ body: '{}' }) });
    const grouped = await ConfigLoader.load({
      root: write({ body: '{ project: {}, agent: {}, check: {}, common: {} }' }),
    });

    expect(grouped.ok && flat.ok ? grouped.config : undefined).toEqual(
      flat.ok ? flat.config : undefined,
    );
  });

  test('a grouped file with a wrong key is refused with the grouped path, nothing is loaded', async () => {
    const loaded = await ConfigLoader.load({
      root: write({ body: "{ project: { nme: 'x' }, agent: { list: ['claude'] } }" }),
    });

    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? '' : loaded.error).toContain('project.nme: not a key of project');
  });

  test('a value the schema refuses is still named, in the flat path of the shape the loader reads', async () => {
    const loaded = await ConfigLoader.load({
      root: write({ body: "{ project: { key: 'x' }, agent: { list: ['claude'] } }" }),
    });

    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? '' : loaded.error).toContain('project.key');
  });
});

describe('the group types', () => {
  test('each group type takes the keys of its group and refuses the keys of another', () => {
    const project: VulcanConfig.Project = { name: 'demo', key: 'DEMO', packages: undefined };
    const agent: VulcanConfig.Agent = { list: ['claude'], packs: ['venizia'] };
    const board: VulcanConfig.Board = { events: { log: true }, page: { title: 'x' } };
    const knowledge: VulcanConfig.Knowledge = { bundle: 'b', okf: {}, atlas: {} };
    const check: VulcanConfig.Check = { doctor: {}, layout: { maxLines: 10 } };
    const common: VulcanConfig.Common = { theme: {}, local: { tmp: 'x' }, remove: {} };
    // @ts-expect-error `events` belongs to board
    const wrong: VulcanConfig.Agent = { events: { log: true } };

    expect([project, agent, board, knowledge, check, common, wrong].length).toBe(7);
  });
});

describe('ConfigGroups paths', () => {
  test('a flat path and its grouped path are each other, whole path, bracket and all', () => {
    const pairs = [
      ['name', 'project.name'],
      ['project.key', 'project.key'],
      ['agents', 'agent.list'],
      ['presets', 'project.presets'],
      ['board.title', 'board.page.title'],
      ['events.log', 'board.events.log'],
      ['atlas.sources[ignis]', 'knowledge.atlas.sources[ignis]'],
      ['okf.brand', 'knowledge.okf.brand'],
      ['knowledge.bundle', 'knowledge.bundle'],
      ['doctor.layout.maxLines', 'check.layout.maxLines'],
      ['doctor.privateValues.acknowledged', 'check.doctor.privateValues.acknowledged'],
      ['claude.settings.permissions.allow', 'agent.claude.settings.permissions.allow'],
      ['guard.outside', 'guard.outside'],
      ['theme.accent', 'common.theme.accent'],
    ];

    for (const [flat, grouped] of pairs) {
      expect(ConfigGroups.groupedPathOf({ path: flat }), flat).toBe(grouped);
      expect(ConfigGroups.flatPathOf({ path: grouped }), grouped).toBe(flat);
    }

    expect(ConfigGroups.groupedEntryOf({ entry: 'atlas.sources: ghost' })).toBe(
      'knowledge.atlas.sources: ghost',
    );
  });

  test('common.remove names its arrays by the grouped path and loads as the flat ones', () => {
    const { flat } = ConfigGroups.toFlat({
      value: {
        common: { remove: { 'knowledge.atlas.sources': ['ignis'], 'project.presets': ['x'] } },
      },
    });

    expect(flat['remove']).toEqual({ 'atlas.sources': ['ignis'], presets: ['x'] });
  });

  test('check.doctor.layout is refused: the layout check is check.layout', () => {
    const { issues } = ConfigGroups.toFlat({ value: { check: { doctor: { layout: {} } } } });

    expect(issues).toEqual(['check.doctor.layout: the layout check is `check.layout`']);
  });
});

describe('toFlat and the shipped mask: the small cases', () => {
  test('an empty knowledge group sets nothing, and one with a key or a tool does', () => {
    expect(ConfigGroups.toFlat({ value: { knowledge: {} } }).flat).toEqual({});
    expect(ConfigGroups.toFlat({ value: { knowledge: { bundle: 'b' } } }).flat).toEqual({
      knowledge: { bundle: 'b' },
    });
    expect(ConfigGroups.toFlat({ value: { knowledge: { okf: {} } } }).flat).toEqual({ okf: {} });
  });

  test('a shipped key named like something on Object.prototype is a stray with a clean message', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const value = JSON.parse(`{ "${key}": {} }`);

      expect(ConfigGroups.strayOfShipped({ value }), key).toEqual([key]);
    }
  });
});

describe('the flat shape is refused', () => {
  test('every moved key is named with its new path, and the way out is the codemod', async () => {
    const loaded = await ConfigLoader.load({
      root: write({
        body: "{ name: 'x', agents: ['claude'], events: { log: true }, okf: {}, atlas: {}, board: { title: 't' }, local: {}, doctor: {}, project: { key: 'AB' } }",
      }),
    });
    const error = loaded.ok ? '' : loaded.error;

    expect(loaded.ok).toBe(false);

    for (const line of [
      'name: moved to project.name',
      'agents: moved to agent.list',
      'events: moved to board.events',
      'okf: moved to knowledge.okf',
      'atlas: moved to knowledge.atlas',
      'board: moved to board.page',
      'local: moved to common.local',
      'doctor: moved to check.doctor',
    ]) {
      expect(error).toContain(line);
    }

    expect(error).toContain('config codemod config-groups . --write');
    expect(error).toContain('migrate apply');
  });

  test('a typo is still the schema error, not a flat-shape refusal', async () => {
    const loaded = await ConfigLoader.load({ root: write({ body: '{ nope: 1 }' }) });

    expect(loaded.ok ? '' : loaded.error).not.toContain('flat shape');
  });

  test('the lenient load is asked by the migration tool only', () => {
    const asked = Bun.spawnSync(
      ['grep', '-rln', '--include=*.ts', 'isLenient: true', join(import.meta.dir, '../../')],
      { stdout: 'pipe' },
    )
      .stdout.toString()
      .split('\n')
      .filter((file) => file !== '' && !file.includes('__tests__'))
      .map((file) => file.slice(file.indexOf('/src/') + 1))
      .toSorted();

    // `vulcan migrate` asks, and `x.command.ts` hands it from `runXCommand` through `ToolRunner.buildEnvironment` to the loader: add a caller here on purpose.
    expect(asked).toEqual(['src/commands/migrate.command.ts', 'src/commands/x.command.ts']);
  });
});
