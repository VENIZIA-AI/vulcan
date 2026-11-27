import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigKeyOrder } from '../../config/common/index.ts';
import { ConfigGroups } from '../../config/groups.ts';
import { ConfigFormat } from '../../config/format.ts';
import type { TConfigFormatResult } from '../../config/format.ts';
import { VulcanConfigSchema } from '../../config/schema.ts';
import { WorkspaceDocs } from '../../create/workspace-docs.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { runCli } from '../helpers/run.helper.ts';

afterAll(removeProjects);

const CONFIG = '.configs/vulcan.config.mts';

const format = (opts: { text: string }): TConfigFormatResult =>
  ConfigFormat.format({ text: opts.text, root: import.meta.dir });

const formatted = (opts: { text: string }): string => {
  const result = format(opts);

  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result.text;
};

const reasonOf = (opts: { text: string }): string => {
  const result = format(opts);

  return result.ok ? '' : result.reason;
};

/** The default export of `text`, run as a module. */
const load = async (opts: { text: string }): Promise<unknown> => {
  const root = createProject({ files: { 'config.mts': opts.text } });
  const module: unknown = await import(join(root, 'config.mts'));

  return typeof module === 'object' && module !== null && 'default' in module
    ? module.default
    : undefined;
};

const OUT_OF_ORDER = `import type { VulcanConfig } from '@venizia/vulcan';

const extra = ['a'];

export default {
  // The colour of the pages.
  theme: { accent: '#8a5a20' }, // trailing note
  remove: { 'atlas.sources': ['vulcan'] },
  custom: 1,
  /**
   * The agents.
   */
  agents: ['claude'],

  // Release order.
  packages: [
    { dir: 'okf', name: '@venizia/vulcan-okf' },
  ],
  later: extra,
  'name': 'demo' // no comma
} satisfies VulcanConfig;
`;

describe('ConfigFormat.format', () => {
  test('moves each key with its comments into the canonical order, unknown keys before remove', () => {
    const result = format({ text: OUT_OF_ORDER });

    expect(result.ok && result.keys).toEqual([
      'name',
      'agents',
      'packages',
      'theme',
      'custom',
      'later',
      'remove',
    ]);
    expect(result.ok && result.moved).toEqual(['name', 'agents', 'packages', 'remove']);
    expect(formatted({ text: OUT_OF_ORDER }))
      .toBe(`import type { VulcanConfig } from '@venizia/vulcan';

const extra = ['a'];

export default {
  'name': 'demo', // no comma
  /**
   * The agents.
   */
  agents: ['claude'],

  // Release order.
  packages: [
    { dir: 'okf', name: '@venizia/vulcan-okf' },
  ],
  // The colour of the pages.
  theme: { accent: '#8a5a20' }, // trailing note
  custom: 1,
  later: extra,
  remove: { 'atlas.sources': ['vulcan'] }
} satisfies VulcanConfig;
`);
  });

  test('the formatted config is the same object, and formatting it again changes nothing', async () => {
    const once = formatted({ text: OUT_OF_ORDER });

    const after = await load({ text: once });
    const before = await load({ text: OUT_OF_ORDER });

    expect(after).toEqual(before);
    expect(formatted({ text: once })).toBe(once);
    expect(format({ text: once }).ok && format({ text: once })).toMatchObject({ moved: [] });
  });

  test('a file in order comes back unchanged, byte for byte, even on one line', () => {
    const text = "export default { name: 'demo', rules: {}, remove: {} } as const;\n";

    expect(format({ text })).toEqual({
      ok: true,
      text,
      keys: ['name', 'rules', 'remove'],
      moved: [],
    });
  });

  test('reads the object through as const, parentheses and defineConfig, keeps CRLF line ends and a last key without a comma', () => {
    expect(
      formatted({ text: 'export default ({\n  rules: {},\n  name: "x",\n} as const);\n' }),
    ).toBe('export default ({\n  name: "x",\n  rules: {},\n} as const);\n');
    expect(
      formatted({
        text: "import { defineConfig } from '@venizia/vulcan';\nexport default defineConfig({\r\n  rules: {},\r\n  name: 'x'\r\n});\r\n",
      }),
    ).toBe(
      "import { defineConfig } from '@venizia/vulcan';\nexport default defineConfig({\r\n  name: 'x',\r\n  rules: {}\r\n});\r\n",
    );
  });

  test('keeps a comment before the closing brace where it is', () => {
    expect(
      formatted({ text: 'export default {\n  rules: {},\n  name: "x",\n  // end\n};\n' }),
    ).toBe('export default {\n  name: "x",\n  rules: {},\n  // end\n};\n');
  });

  test('refuses a spread, a computed key, a default export that is not an object, and keys sharing a line', () => {
    expect(
      reasonOf({ text: 'const base = {};\nexport default {\n  ...base,\n  name: "x",\n};\n' }),
    ).toContain('spread (`...base`)');
    expect(reasonOf({ text: "export default {\n  ['na' + 'me']: 'x',\n};\n" })).toContain(
      'computed key',
    );
    expect(reasonOf({ text: 'const config = {};\nexport default config;\n' })).toContain(
      'not an object literal',
    );
    expect(reasonOf({ text: 'export const config = {};\n' })).toContain('no `export default`');
    expect(reasonOf({ text: 'export default {\n  rules: {}, name: "x",\n};\n' })).toContain(
      '`rules` shares its line with `name`',
    );
    expect(reasonOf({ text: 'export default { rules: {}, name: "x" };\n' })).toContain(
      'the line of `{`',
    );
  });

  test('every key of the order is a key of the config schema', () => {
    const schemaKeys = Object.keys(VulcanConfigSchema.shape);

    expect(
      [...ConfigKeyOrder.KEYS, ConfigKeyOrder.LAST].filter((key) => !schemaKeys.includes(key)),
    ).toEqual([]);
  });

  test('the config vulcan project init writes is in order', () => {
    const files = WorkspaceDocs.renderSplitConfig({
      project: 'demo',
      key: 'DEMO',
      block: { layout: {}, packages: [], presets: [], sources: [] },
    });

    expect(files.map((file) => file.path)).toContain('.configs/vulcan/project.mts');

    for (const file of files.filter((entry) => entry.path === '.configs/vulcan.config.mts')) {
      expect(format({ text: file.content }), file.path).toMatchObject({ ok: true, moved: [] });
    }
  });
});

describe('vulcan config format', () => {
  test('--check exits 1 and names the keys that move; format writes the file; then --check passes', () => {
    const root = createProject({ files: { [CONFIG]: OUT_OF_ORDER } });
    const check = runCli({ args: ['config', 'format', '--check'], cwd: root });

    expect(check.code).toBe(1);
    expect(check.stderr).toContain('4 key(s) out of order: name, agents, packages, remove');
    expect(readFileSync(join(root, CONFIG), 'utf8')).toBe(OUT_OF_ORDER);

    const written = runCli({ args: ['config', 'format'], cwd: root });

    expect(written.code).toBe(0);
    expect(readFileSync(join(root, CONFIG), 'utf8')).toBe(formatted({ text: OUT_OF_ORDER }));
    expect(runCli({ args: ['config', 'format', '--check'], cwd: root }).code).toBe(0);
  });

  test('exits 2 on a config it cannot order, on no config and on an unknown argument', () => {
    const spread = createProject({
      files: { [CONFIG]: 'const base = {};\nexport default {\n  ...base,\n};\n' },
    });
    const refused = runCli({ args: ['config', 'format'], cwd: spread });

    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('cannot order the keys');
    expect(runCli({ args: ['config', 'format'], cwd: createProject({ files: {} }) }).code).toBe(2);
    expect(runCli({ args: ['config', 'format', '--fix'], cwd: spread }).code).toBe(2);
    expect(runCli({ args: ['config', 'format', '--check', '--check'], cwd: spread }).code).toBe(2);
  });

  test('the doctor notes a config out of order, and says nothing of one in order', async () => {
    const config = (opts: { text: string }) => createProject({ files: { [CONFIG]: opts.text } });
    const notes = async (opts: { root: string }) => {
      const all = await DoctorRunner.runNotes({ root: opts.root, env: {} });

      return all.filter((note) => note.check === 'config-order');
    };
    const outOfOrder = await notes({
      root: config({ text: "export default {\n  agent: {},\n  project: { name: 'demo' },\n};\n" }),
    });

    expect(outOfOrder.map((note) => note.message)).toEqual([
      '1 key(s) out of the canonical order (project): run `bun node_modules/.bin/vulcan config format`',
    ]);
    const result = await notes({
      root: config({ text: "export default {\n  project: { name: 'demo' },\n  agent: {},\n};\n" }),
    });
    expect(result).toEqual([]);
  });
});

describe('a grouped file', () => {
  const GROUPED = [
    'export default {',
    '  // The tools.',
    '  knowledge: {',
    '    atlas: { prebuilt: false },',
    "    bundle: '.agents/knowledge', // where",
    '    okf: {},',
    '  },',
    '  common: {',
    '    remove: {},',
    '    theme: {},',
    '  },',
    '  agent: {',
    '    claude: {},',
    "    list: ['claude'],",
    '  },',
    '  project: {',
    "    key: 'A',",
    "    name: 'a',",
    '  },',
    '  guard: { outside: "deny", asks: "ask" },',
    '};',
    '',
  ].join('\n');

  test('its groups and the keys inside each are put in order, with their comments', () => {
    const result = format({ text: GROUPED });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.keys : []).toEqual([
      'project',
      'agent',
      'guard',
      'knowledge',
      'common',
    ]);

    const text = result.ok ? result.text : '';

    expect(text.indexOf("name: 'a'")).toBeLessThan(text.indexOf("key: 'A'"));
    expect(text.indexOf('list:')).toBeLessThan(text.indexOf('claude: {}'));
    expect(text.indexOf("bundle: '.agents/knowledge', // where")).toBeLessThan(
      text.indexOf('okf:'),
    );
    expect(text.indexOf('okf:')).toBeLessThan(text.indexOf('atlas:'));
    expect(text.indexOf('theme: {}')).toBeLessThan(text.indexOf('remove: {}'));
    expect(text).toContain('// The tools.\n  knowledge: {');
    // `guard` keeps its keys as written.
    expect(text).toContain('guard: { outside: "deny", asks: "ask" }');
  });

  test('it is in order after the format, and the moved keys are named by their group', () => {
    const first = format({ text: GROUPED });
    const text = first.ok ? first.text : '';

    expect(format({ text })).toMatchObject({ ok: true, moved: [] });
    expect(first.ok ? first.moved : []).toEqual(
      expect.arrayContaining(['project.name', 'agent.list', 'knowledge.atlas', 'common.theme']),
    );
  });

  test('a group that is a module or a variable is left as it is; a spread in a group is refused with the group named', () => {
    const module =
      'export default {\n  common,\n  agent: claude,\n  project: {\n    name: "a",\n    key: "A",\n  },\n};\n';
    const spread = 'export default {\n  project: {\n    key: "A",\n    ...rest,\n  },\n};\n';

    expect(reasonOf({ text: module })).toBe('');
    expect(formatted({ text: module })).toContain('agent: claude');
    expect(
      reasonOf({ text: 'export default {\n  project: { key: "A", name: "a" },\n};\n' }),
    ).toContain('in `project`: the first key is on the line of `{`');
    expect(reasonOf({ text: spread })).toContain('in `project`');
    expect(reasonOf({ text: spread })).toContain('spread');
  });

  test('the inner orders list every key of every group, and nothing the group does not have', () => {
    const schema = VulcanConfigSchema.shape;
    const knowledge = [
      ...Object.keys(
        (schema.knowledge as unknown as { def: { innerType: { shape: object } } }).def.innerType
          .shape,
      ),
      'okf',
      'atlas',
    ].sort();

    expect([...(ConfigKeyOrder.INNER['knowledge'] ?? [])].sort()).toEqual(knowledge);
    expect(ConfigKeyOrder.INNER['project']).toEqual([
      'name',
      'key',
      'layout',
      'packages',
      'presets',
    ]);
    expect([...ConfigKeyOrder.GROUPS]).toEqual(ConfigGroups.names());
  });
});

describe('doctor and a grouped file', () => {
  test('an out-of-order grouped file is named once with its group keys; an in-order one is quiet', async () => {
    const out = createProject({
      files: {
        [CONFIG]:
          "export default {\n  agent: {\n    claude: {},\n    list: ['claude'],\n  },\n};\n",
      },
    });
    const ok = createProject({
      files: {
        [CONFIG]:
          "export default {\n  agent: {\n    list: ['claude'],\n    claude: {},\n  },\n};\n",
      },
    });
    const messages = async (root: string): Promise<string[]> => {
      const notes = await DoctorRunner.runNotes({ root, env: {} });

      return notes.filter((note) => note.check === 'config-order').map((note) => note.message);
    };

    const result = await messages(out);
    expect(result[0]).toContain('agent.list');
    const result2 = await messages(ok);
    expect(result2).toEqual([]);
  });
});
