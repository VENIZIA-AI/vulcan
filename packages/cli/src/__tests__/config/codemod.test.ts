import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigCodemod } from '../../config/codemod.ts';
import type { IFileChange, TCodemodResult } from '../../config/codemod.ts';
import { ConfigFormat } from '../../config/format.ts';
import { ConfigLoader } from '../../config/loader.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const CONFIG = '.configs/vulcan.config.mts';

/** A flat single-file config with a comment on most keys, a one-line object, a nested remove, and every section that moves. */
const FLAT = `import type { VulcanConfig } from '@venizia/vulcan';

export default {
  // The tools.
  project: { key: 'DEMO' },
  name: 'demo',
  agents: ['claude'], // the agents
  rules: { 'V-W-01': 'on-user-word' },
  packs: ['venizia'],
  board: {
    // The page.
    owner: 'Owner',
    title: 'Demo Board',
  },
  events: { log: true },
  knowledge: {
    bundle: '.agents/knowledge',
    // The changelog folder.
    changelogs: 'docs/changelogs',
  },
  okf: { brand: 'Demo' },
  atlas: {
    prebuilt: false,
  },
  doctor: {
    privateValues: { acknowledged: [] },
  },
  guard: {
    outside: 'deny',
  },
  theme: { accent: '#8a5a20', accentDark: '#dead6a' },
  local: { autoClean: false },
  remove: { 'atlas.sources': ['x'] },
} satisfies VulcanConfig;
`;

const files = (
  opts: Record<string, string>,
): { root: string; read: (path: string) => string | undefined } => {
  const root = createProject({ files: opts });

  return {
    root,
    read: (path) =>
      existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined,
  };
};

const apply = (opts: { root: string; changes: IFileChange[] }): void => {
  for (const change of opts.changes) {
    const path = join(opts.root, change.path);

    if (change.text === undefined) {
      rmSync(path, { force: true });
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, change.text);
    }
  }
};

const ok = (result: TCodemodResult): { changes: IFileChange[]; notes: string[] } => {
  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result;
};

const textOf = (opts: { changes: IFileChange[]; path: string }): string =>
  opts.changes.find((change) => change.path === opts.path)?.text ?? '';

/** The resolved config the loader makes of the files under `root`, as JSON text. */
const loaded = async (root: string): Promise<string> => {
  const result = await ConfigLoader.load({ root });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return JSON.stringify(result.config);
};

describe('config-groups: a flat single file to groups', () => {
  test('every key lands in its group, in order, with its comments, and the file loads to the same config', async () => {
    const before = files({ [CONFIG]: FLAT, 'package.json': '{}' });
    const { changes } = ok(ConfigCodemod.run({ root: before.root, read: before.read }));
    const text = textOf({ changes, path: CONFIG });

    expect(changes.map((change) => change.path)).toEqual([CONFIG]);
    expect(text).toContain("name: 'demo',\n    // The tools.\n    key: 'DEMO',");
    expect(text).toContain("list: ['claude'], // the agents");
    expect(text).toContain('page: {\n      // The page.\n      owner');
    expect(text).toContain("remove: { 'knowledge.atlas.sources': ['x'] }");
    expect(text).toContain('// The changelog folder.\n    changelogs');
    expect(text.indexOf('project: {')).toBeLessThan(text.indexOf('agent: {'));
    expect(text.indexOf('guard: {')).toBeLessThan(text.indexOf('board: {'));
    expect(text.indexOf('check: {')).toBeLessThan(text.indexOf('common: {'));
    expect(text.indexOf('name:')).toBeLessThan(text.indexOf('key:'));

    // The result is what `config format` would write already.
    expect(ConfigFormat.format({ text, root: before.root })).toMatchObject({ ok: true, moved: [] });

    apply({ root: before.root, changes });

    const flat = files({ [CONFIG]: FLAT, 'package.json': '{}' });

    const result = await loaded(before.root);
    const expected = await loaded(flat.root);

    expect(result).toBe(expected);
  });

  test('the result is in the canonical order and a second run changes nothing', () => {
    const before = files({ [CONFIG]: FLAT });
    const first = ok(ConfigCodemod.run({ root: before.root, read: before.read }));

    apply({ root: before.root, changes: first.changes });

    const second = ok(ConfigCodemod.run({ root: before.root, read: before.read }));

    expect(second.changes).toEqual([]);
    expect(second.notes[0]).toContain('in groups already');
  });

  test('a file with no config, or an empty one, has nothing to do', () => {
    expect(ok(ConfigCodemod.run({ root: '/x', read: () => undefined })).changes).toEqual([]);
    expect(
      ok(ConfigCodemod.run({ root: '/x', read: () => 'export default {\n};\n' })).changes,
    ).toEqual([]);
  });

  test('a one-line group is opened; a comment inside one is refused', () => {
    const inline = ok(
      ConfigCodemod.run({
        root: '/x',
        read: () => "export default {\n  project: { key: 'A' },\n  agents: ['claude'],\n};\n",
      }),
    );

    expect(textOf({ changes: inline.changes, path: CONFIG })).toContain(
      "project: {\n    key: 'A',\n  },",
    );

    const commented = ConfigCodemod.run({
      root: '/x',
      read: () => "export default {\n  agents: [],\n  project: { key: 'A' /* the key */ },\n};\n",
    });

    expect(commented.ok).toBe(false);
  });
});

describe('config-groups: what it refuses, with nothing written', () => {
  const refused = (text: string, opts: { split?: boolean } = {}): string => {
    const result = ConfigCodemod.run({ root: '/x', read: () => text, ...opts });

    return result.ok ? '' : result.reason;
  };

  test('a spread, a computed key, a typo and no object literal', () => {
    expect(refused('export default {\n  ...base,\n};\n')).toContain('spread');
    expect(refused("export default {\n  ['a' + 'b']: 1,\n};\n")).toContain('computed');
    expect(refused('export default {\n  nme: 1,\n};\n')).toContain('`nme` is not a key');
    expect(refused('export default make();\n')).toContain('not an object literal');
  });

  test('doctor with a layout key, and knowledge as a variable next to okf', () => {
    expect(refused('export default {\n  doctor: {\n    layout: {},\n  },\n};\n')).toContain(
      'check.layout',
    );
    expect(refused('export default {\n  knowledge,\n  okf: {},\n};\n')).toContain(
      'write `knowledge` as a literal',
    );
  });

  test('a statement besides imports and the export, when the groups become modules', () => {
    const text = "const x = 1;\nexport default {\n  agents: ['claude'],\n};\n";

    expect(refused(text, { split: true })).toContain('move it by hand');
    expect(refused(text)).toBe('');
  });
});

/** The split the 0.5.0-7 and -8 scaffolds wrote: modules for claude, doctor, okf and packages. */
const SPLIT = {
  [CONFIG]: `import type { VulcanConfig } from '@venizia/vulcan';
import { claude, doctor, okf, packages } from './vulcan/index.mts';

export default {
  project: { key: 'DEMO' },
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
  packages,
  okf,
  claude,
  doctor,
} satisfies VulcanConfig;
`,
  '.configs/vulcan/index.mts':
    "export { claude } from './claude.mts';\nexport { doctor } from './doctor.mts';\nexport { okf } from './okf.mts';\nexport { packages } from './packages.mts';\n",
  '.configs/vulcan/claude.mts':
    "import type { VulcanConfig } from '@venizia/vulcan';\n\n// What Claude may run.\nexport const claude = {\n  settings: { env: {} },\n} satisfies NonNullable<VulcanConfig['claude']>;\n",
  '.configs/vulcan/doctor.mts':
    "import type { VulcanConfig } from '@venizia/vulcan';\n\nexport const doctor = {} satisfies NonNullable<VulcanConfig['doctor']>;\n",
  '.configs/vulcan/okf.mts':
    "import type { VulcanConfig } from '@venizia/vulcan';\n\nexport const okf = { brand: 'Demo' } satisfies NonNullable<VulcanConfig['okf']>;\n",
  '.configs/vulcan/packages.mts':
    "import type { VulcanConfig } from '@venizia/vulcan';\n\nexport const packages: VulcanConfig['packages'] = undefined;\n",
  'package.json': '{ "name": "demo", "workspaces": [] }',
};

describe('config-groups: a split of the 0.5.0 scaffold', () => {
  test('into groups in one file: the modules keep their files and their types become the groups', async () => {
    const before = files(SPLIT);
    const { changes } = ok(ConfigCodemod.run({ root: before.root, read: before.read }));
    const main = textOf({ changes, path: CONFIG });

    expect(main).toContain("import { claude, doctor, okf, packages } from './vulcan/index.mts';");
    expect(main).toContain("list: ['claude'],");
    expect(main).toContain('    packages,');
    expect(main).toContain('    claude,');
    expect(main).toContain('    doctor,');
    expect(textOf({ changes, path: '.configs/vulcan/claude.mts' })).toContain(
      "VulcanConfig.Agent['claude']",
    );
    expect(textOf({ changes, path: '.configs/vulcan/doctor.mts' })).toContain(
      "VulcanConfig.Check['doctor']",
    );
    expect(textOf({ changes, path: '.configs/vulcan/okf.mts' })).toContain(
      "VulcanConfig.Knowledge['okf']",
    );
    expect(textOf({ changes, path: '.configs/vulcan/packages.mts' })).toContain(
      "VulcanConfig.Project['packages']",
    );

    const after = files(SPLIT);
    const flat = await loaded(after.root);

    apply({ root: after.root, changes });

    const result = await loaded(after.root);
    expect(result).toBe(flat);
  });

  test('into one module per group: every value and comment carried, the old modules gone, the same config', async () => {
    const before = files(SPLIT);
    const { changes } = ok(
      ConfigCodemod.run({ root: before.root, read: before.read, split: true }),
    );
    const paths = changes.map((change) => change.path).sort();

    expect(paths).toEqual(
      [
        CONFIG,
        '.configs/vulcan/agent.mts',
        '.configs/vulcan/claude.mts',
        '.configs/vulcan/doctor.mts',
        '.configs/vulcan/check.mts',
        '.configs/vulcan/index.mts',
        '.configs/vulcan/okf.mts',
        '.configs/vulcan/knowledge.mts',
        '.configs/vulcan/packages.mts',
        '.configs/vulcan/project.mts',
      ].sort(),
    );
    expect(
      changes
        .filter((change) => change.text === undefined)
        .map((change) => change.path)
        .sort(),
    ).toEqual([
      '.configs/vulcan/claude.mts',
      '.configs/vulcan/doctor.mts',
      '.configs/vulcan/okf.mts',
      '.configs/vulcan/packages.mts',
    ]);
    expect(textOf({ changes, path: CONFIG })).toContain(
      'export default { project, agent, knowledge, check } satisfies VulcanConfig;',
    );
    expect(textOf({ changes, path: '.configs/vulcan/agent.mts' })).toContain(
      "export const agent = {\n  list: ['claude'],\n  rules: { 'V-W-01': 'on-user-word' },\n  // What Claude may run.\n  claude: {\n    settings: { env: {} },\n  },\n} satisfies VulcanConfig.Agent;",
    );
    expect(textOf({ changes, path: '.configs/vulcan/knowledge.mts' })).toContain(
      "okf: { brand: 'Demo' }",
    );
    expect(textOf({ changes, path: '.configs/vulcan/project.mts' })).toContain(
      'packages: undefined,',
    );
    expect(textOf({ changes, path: '.configs/vulcan/index.mts' })).toBe(
      "export { project } from './project.mts';\nexport { agent } from './agent.mts';\nexport { knowledge } from './knowledge.mts';\nexport { check } from './check.mts';\n",
    );

    const after = files(SPLIT);
    const flat = await loaded(after.root);

    apply({ root: after.root, changes });

    expect(existsSync(join(after.root, '.configs/vulcan/claude.mts'))).toBe(false);
    const result = await loaded(after.root);
    expect(result).toBe(flat);
  });

  test('a flat single file into modules: the same config, comments kept', async () => {
    const before = files({ [CONFIG]: FLAT, 'package.json': '{}' });
    const { changes } = ok(
      ConfigCodemod.run({ root: before.root, read: before.read, split: true }),
    );

    expect(textOf({ changes, path: '.configs/vulcan/project.mts' })).toContain(
      "export const project = {\n  name: 'demo',\n  // The tools.\n  key: 'DEMO',",
    );
    expect(textOf({ changes, path: '.configs/vulcan/guard.mts' })).toBe(
      "import type { VulcanConfig } from '@venizia/vulcan';\n\nexport const guard = {\n  outside: 'deny',\n} satisfies NonNullable<VulcanConfig.Guard>;\n",
    );
    apply({ root: before.root, changes });

    const flat = files({ [CONFIG]: FLAT, 'package.json': '{}' });

    const result = await loaded(before.root);
    const expected = await loaded(flat.root);

    expect(result).toBe(expected);
  });

  test('an import the values use is carried into the module one folder deeper', () => {
    const text = [
      "import { bundle } from './paths.mts';",
      "import type { VulcanConfig } from '@venizia/vulcan';",
      '',
      'export default {',
      '  knowledge: {',
      '    bundle: bundle,',
      '  },',
      "  agents: ['claude'],",
      '} satisfies VulcanConfig;',
      '',
    ].join('\n');
    const { changes } = ok(
      ConfigCodemod.run({
        root: '/x',
        read: (path) => (path === CONFIG ? text : undefined),
        split: true,
      }),
    );

    expect(textOf({ changes, path: '.configs/vulcan/knowledge.mts' })).toContain(
      "import { bundle } from '../paths.mts';",
    );
    expect(textOf({ changes, path: '.configs/vulcan/agent.mts' })).not.toContain('paths.mts');
  });
});

describe('vulcan config codemod', () => {
  const run = (root: string, args: string[]) =>
    runCli({ args: ['config', 'codemod', ...args], cwd: root });

  test('--list names the codemod; an unknown name or option (--reverse included) is a usage error', () => {
    const root = createProject({ files: {} });

    expect(run(root, ['--list']).stdout).toContain('config-groups');
    expect(run(root, ['nope']).code).toBe(2);
    expect(run(root, ['config-groups', '--bad']).code).toBe(2);
    expect(run(root, ['config-groups', '.', '--reverse']).code).toBe(2);
  });

  test('without --write it lists and writes nothing; with --write it writes; a second run has nothing to do', () => {
    const root = createProject({ files: { [CONFIG]: FLAT, 'package.json': '{}' } });
    const dry = run(root, ['config-groups', '.']);

    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('would write  .configs/vulcan.config.mts');
    expect(readFileSync(join(root, CONFIG), 'utf8')).toBe(FLAT);

    const written = run(root, ['config-groups', '.', '--write']);

    expect(written.code).toBe(0);
    expect(written.stdout).toContain('write  .configs/vulcan.config.mts');
    expect(readFileSync(join(root, CONFIG), 'utf8')).toContain('agent: {');
    expect(run(root, ['config-groups', '.', '--write']).stdout).toContain('in groups already');
  });

  test('a config it cannot move is refused, exit 2, nothing written', () => {
    const text = 'export default {\n  ...base,\n};\n';
    const root = createProject({ files: { [CONFIG]: text } });
    const result = run(root, ['config-groups', '.', '--write']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('nothing was written');
    expect(readFileSync(join(root, CONFIG), 'utf8')).toBe(text);
  });

  test('the folder is the argument, and --split --write makes the modules', () => {
    const root = createProject({
      files: { 'app/.configs/vulcan.config.mts': FLAT, 'app/package.json': '{}' },
    });
    const result = run(root, ['config-groups', 'app', '--split', '--write']);

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'app/.configs/vulcan/agent.mts'))).toBe(true);
    expect(readFileSync(join(root, 'app/.configs/vulcan.config.mts'), 'utf8')).toContain(
      "from './vulcan/index.mts'",
    );
  });
});

/** The number of comment lines (`//` and block comments) in the given texts: what a codemod must not lose. */
const commentsIn = (texts: (string | undefined)[]): number =>
  texts.reduce((sum, text) => sum + (text?.match(/(^|\s)\/\/|\/\*/g)?.length ?? 0), 0);

describe('config-groups --split: nothing a user wrote is lost or deleted', () => {
  const FIXTURE = {
    ...SPLIT,
    [CONFIG]: `// The header.
import type { VulcanConfig } from '@venizia/vulcan';
import { claude, doctor, okf, packages } from './vulcan/index.mts';

// Why the config is split.
export default {
  project: { key: 'DEMO' },
  agents: ['claude'],
  // The guard's own comment,
  // over two lines.
  guard: {
    outside: 'deny',
  },
  packages,
  okf,
  claude,
  doctor,
} satisfies VulcanConfig;
`,
  };

  test("every comment is kept: the header, the one above export default, the guard's and the one above a folded const", () => {
    const before = files(FIXTURE);
    const { changes } = ok(
      ConfigCodemod.run({ root: before.root, read: before.read, split: true }),
    );
    const out = changes.filter((change) => change.text !== undefined).map((change) => change.text);
    const text = out.join('\n');
    const inCount = commentsIn(Object.values(FIXTURE));

    expect(text).toContain('// The header.');
    expect(text).toContain('// Why the config is split.');
    expect(text).toContain("// The guard's own comment,\n// over two lines.\nexport const guard =");
    expect(text).toContain('// What Claude may run.');
    expect(commentsIn(out)).toBe(inCount);
  });

  test('a single file keeps every comment too', () => {
    const before = files(FIXTURE);
    const { changes } = ok(ConfigCodemod.run({ root: before.root, read: before.read }));
    const after = changes.map((change) => change.text);

    // Only the main file and the type of each module change: the modules' comments stay in their files.
    expect(commentsIn(after)).toBe(commentsIn([FIXTURE[CONFIG], ...Object.values(SPLIT).slice(1)]));
  });

  test('no group starts with a blank line after its brace', () => {
    const before = files({
      [CONFIG]: 'export default {\n  agents: [],\n\n  // A.\n  rules: {},\n\n  theme: {},\n};\n',
    });
    const { changes } = ok(ConfigCodemod.run({ root: before.root, read: before.read }));

    expect(textOf({ changes, path: CONFIG })).not.toMatch(/\{\n\n/);
  });

  const refused = (
    extra: Record<string, string>,
  ): { reason: string; read: ReturnType<typeof files>['read'] } => {
    const before = files({ ...FIXTURE, ...extra });
    const result = ConfigCodemod.run({ root: before.root, read: before.read, split: true });

    return { reason: result.ok ? '' : result.reason, read: before.read };
  };

  test('a file outside .configs/vulcan/ is never folded or deleted', () => {
    const { reason } = refused({
      '.configs/vulcan/index.mts':
        "export { claude } from '../../../shared/claude.mts';\nexport { doctor } from './doctor.mts';\nexport { okf } from './okf.mts';\nexport { packages } from './packages.mts';\n",
    });

    expect(reason).toContain('is not under .configs/vulcan/');
  });

  test('a module with an extra export, a local name or a statement is refused with its line', () => {
    const extra = refused({
      '.configs/vulcan/claude.mts':
        "import type { VulcanConfig } from '@venizia/vulcan';\n\nexport const ALLOW = ['a'];\nexport const claude = {} satisfies NonNullable<VulcanConfig['claude']>;\n",
    });
    const local = refused({
      '.configs/vulcan/claude.mts':
        "import type { VulcanConfig } from '@venizia/vulcan';\n\nconst base = { a: 1 };\nexport const claude = { ...base } satisfies NonNullable<VulcanConfig['claude']>;\n",
    });
    const reexports = refused({
      '.configs/vulcan/index.mts':
        "export { claude } from './claude.mts';\nexport { doctor } from './doctor.mts';\nexport { okf } from './okf.mts';\nexport { packages } from './packages.mts';\nexport const extra = 1;\n",
    });

    expect(extra.reason).toContain('holds more than the type import and `claude`');
    expect(extra.reason).toContain('line 3');
    expect(local.reason).toContain('line 3');
    expect(local.reason).toContain('const base');
    expect(reexports.reason).toContain('has more than re-exports');
    expect(reexports.reason).toContain('line 5');
  });

  test('an index that exports a name the run does not fold is refused', () => {
    const { reason } = refused({
      '.configs/vulcan/index.mts':
        "export { claude } from './claude.mts';\nexport { doctor } from './doctor.mts';\nexport { okf } from './okf.mts';\nexport { packages } from './packages.mts';\nexport { mine } from './mine.mts';\n",
    });

    expect(reason).toContain('exports `mine`, which this run does not fold');
  });

  test('a module file of a group that is already there and is not folded is never overwritten', () => {
    const { reason } = refused({
      '.configs/vulcan/agent.mts': 'export const agent = { mine: 1 };\n',
    });

    expect(reason).toContain(
      '.configs/vulcan/agent.mts exists and is not one of the modules this run folds',
    );
  });
});

describe('vulcan config codemod --split --write: what it deletes', () => {
  const run = (root: string, args: string[]) =>
    runCli({ args: ['config', 'codemod', ...args], cwd: root });

  test('a file outside the project that an import names is left alone, exit 2, nothing written', () => {
    const parent = createProject({
      files: {
        'shared/claude.mts': 'export const claude = { settings: {} };\n',
        'app/package.json': '{}',
        'app/.configs/vulcan.config.mts':
          "import { claude } from './vulcan/index.mts';\n\nexport default {\n  agents: ['claude'],\n  claude,\n};\n",
        'app/.configs/vulcan/index.mts': "export { claude } from '../../../shared/claude.mts';\n",
      },
    });
    const result = run(join(parent, 'app'), ['config-groups', '.', '--split', '--write']);

    expect(result.code).toBe(2);
    expect(existsSync(join(parent, 'shared/claude.mts'))).toBe(true);
    expect(existsSync(join(parent, 'app/.configs/vulcan/agent.mts'))).toBe(false);
  });

  test('a module that is a link to a file outside .configs/vulcan/ is not read, so nothing is folded or deleted', () => {
    const root = createProject({
      files: { ...SPLIT, 'shared.mts': 'export const claude = { settings: {} };\n' },
    });

    rmSync(join(root, '.configs/vulcan/claude.mts'));
    symlinkSync(join(root, 'shared.mts'), join(root, '.configs/vulcan/claude.mts'));

    const result = run(root, ['config-groups', '.', '--split', '--write']);

    expect(result.code).toBe(2);
    expect(existsSync(join(root, 'shared.mts'))).toBe(true);
    expect(existsSync(join(root, '.configs/vulcan/agent.mts'))).toBe(false);
  });
});
