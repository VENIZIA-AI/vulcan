import { afterAll, describe, expect, test } from 'bun:test';
import { ConfigGroups, ConfigLoader } from '../../config/index.ts';
import type { VulcanConfig } from '../../index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

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
  test('the grouped file and the flat file of FLAT load to the same resolved config', async () => {
    const flat = await ConfigLoader.load({ root: write({ body: JSON.stringify(FLAT) }) });
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
