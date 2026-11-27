import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigCodemod } from '../../config/codemod.ts';
import { ConfigTypesCodemod } from '../../config/config-types.ts';
import type { TCodemodResult } from '../../config/common/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { runCli } from '../helpers/run.helper.ts';

afterAll(removeProjects);

const CONFIG = '.configs/vulcan.config.mts';
const PACKAGE = "'@venizia/vulcan'";

const run = (opts: { files: Record<string, string>; isReverse?: boolean }): TCodemodResult =>
  ConfigTypesCodemod.run({
    root: process.cwd(),
    read: (path) => opts.files[path],
    isReverse: opts.isReverse,
  });

const ok = (result: TCodemodResult) => {
  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result;
};

/** The files after the run: the input with every change applied. */
const after = (opts: {
  files: Record<string, string>;
  isReverse?: boolean;
}): Record<string, string> => ({
  ...opts.files,
  ...Object.fromEntries(ok(run(opts)).changes.map((change) => [change.path, change.text ?? ''])),
});

/** One file in, one file out. */
const rewrite = (opts: { text: string; isReverse?: boolean }): string =>
  after({ files: { [CONFIG]: opts.text }, isReverse: opts.isReverse })[CONFIG] ?? '';

const SINGLE = `import type { VulcanConfig } from ${PACKAGE};

// The whole file.
export default {
  project: { key: 'A' }, // the key
} satisfies VulcanConfig;
`;

const SPLIT: Record<string, string> = {
  [CONFIG]: `import type { VulcanConfig } from ${PACKAGE};
import { project, guard } from './vulcan/index.mts';

export default { project, guard } satisfies VulcanConfig;
`,
  '.configs/vulcan/index.mts': `export { project } from './project.mts';
export { guard } from './guard.mts';
`,
  '.configs/vulcan/project.mts': `import type { VulcanConfig } from ${PACKAGE};
import { paths } from './paths.mts';

/** The project. */
export const project = {
  packages: paths,
} satisfies VulcanConfig.Project;
`,
  '.configs/vulcan/guard.mts': `import type { VulcanConfig } from ${PACKAGE};

export const guard = {} satisfies NonNullable<VulcanConfig.Guard>;
`,
  '.configs/vulcan/paths.mts': `import type { VulcanConfig } from ${PACKAGE};

export const paths: VulcanConfig.Project['packages'] = [];
`,
};

/** One name imported twice, in one statement and in two: only one of the two bindings could be followed. */
const TWICE = [
  `import type { VulcanConfig, VulcanConfig as V2 } from ${PACKAGE};

export const a = {} satisfies VulcanConfig;
export const b = {} satisfies V2.Board;
`,
  `import type { TFlatConfig } from ${PACKAGE};
import type { TFlatConfig as Flat } from ${PACKAGE};

export const a = (config: TFlatConfig): Flat => config;
`,
];

describe('a name imported twice', () => {
  test.each(TWICE)('leaves the file whole, with a note', (text) => {
    const result = ok(run({ files: { [CONFIG]: text } }));

    expect(result.changes).toEqual([]);
    expect(result.notes.join('\n')).toContain('imports');
    expect(result.notes.join('\n')).toContain('twice');
  });
});

describe('a long export line is written as the formatter writes it', () => {
  const groups = ['project', 'agent', 'guard', 'board', 'knowledge', 'check', 'common'];
  const file = (line: string) => `import type { VulcanConfig } from ${PACKAGE};\n\n${line}\n`;

  test('over 100 characters after the rename: one property a line', () => {
    const line = `export default { ${groups.join(', ')} } satisfies VulcanConfig;`;

    expect(line.length).toBeLessThanOrEqual(100);
    expect(rewrite({ text: file(line) })).toContain(
      `export default {\n${groups.map((group) => `  ${group},\n`).join('')}} satisfies VulcanConfigType;\n`,
    );
  });

  test('a short line stays on one line', () => {
    expect(rewrite({ text: file('export default { project } satisfies VulcanConfig;') })).toContain(
      'export default { project } satisfies VulcanConfigType;',
    );
  });
});

const BOTH = `import { defineConfig, type VulcanConfig } from ${PACKAGE};

const agent: VulcanConfig.Agent = {};
const knowledge: VulcanConfig['knowledge'] = {};

export default defineConfig({ agent, knowledge } satisfies VulcanConfig);
`;

const FLAT_NAMES = `import type { TFlatConfig, TResolvedConfig as Resolved } from ${PACKAGE};

export const read = (config: Resolved): TFlatConfig => config;
export type TDoctor = NonNullable<TFlatConfig['doctor']>;
`;

describe('the config-types codemod', () => {
  test('a single file: the whole-file type is VulcanConfigType, comments kept', () => {
    expect(rewrite({ text: SINGLE })).toBe(SINGLE.replaceAll('VulcanConfig', 'VulcanConfigType'));
  });

  test('a split config: the group types get Type, in every module the config reaches', () => {
    const result = after({ files: SPLIT });

    expect(result[CONFIG]).toContain(`import type { VulcanConfigType } from ${PACKAGE};`);
    expect(result[CONFIG]).toContain('satisfies VulcanConfigType;');
    expect(result['.configs/vulcan/project.mts']).toBe(
      SPLIT['.configs/vulcan/project.mts']?.replace('.Project;', '.ProjectType;'),
    );
    expect(result['.configs/vulcan/guard.mts']).toContain('NonNullable<VulcanConfig.GuardType>');
    expect(result['.configs/vulcan/guard.mts']).toContain(
      `import type { VulcanConfig } from ${PACKAGE};`,
    );
    expect(result['.configs/vulcan/paths.mts']).toContain("VulcanConfig.ProjectType['packages']");
    expect(result['.configs/vulcan/index.mts']).toBe(SPLIT['.configs/vulcan/index.mts']);
  });

  test('every group name is renamed', () => {
    const names = ['Project', 'Agent', 'Guard', 'Board', 'Knowledge', 'Check', 'Common', 'Groups'];
    const text = `import type { VulcanConfig } from ${PACKAGE};
${names.map((name) => `export type T${name} = VulcanConfig.${name};`).join('\n')}
`;
    const result = rewrite({ text });

    for (const name of names) {
      expect(result).toContain(`export type T${name} = VulcanConfig.${name}Type;`);
    }

    expect(result).not.toContain('VulcanConfigType');
  });

  test('both names in one file: the namespace stays imported and VulcanConfigType is added', () => {
    expect(rewrite({ text: BOTH })).toBe(
      `import { defineConfig, type VulcanConfig, type VulcanConfigType } from ${PACKAGE};

const agent: VulcanConfig.AgentType = {};
const knowledge: VulcanConfigType['knowledge'] = {};

export default defineConfig({ agent, knowledge } satisfies VulcanConfigType);
`,
    );
  });

  test('TFlatConfig and TResolvedConfig are renamed, an alias keeps its name', () => {
    expect(rewrite({ text: FLAT_NAMES })).toBe(
      `import type { TVulcanConfigInput, TVulcanConfigOutput as Resolved } from ${PACKAGE};

export const read = (config: Resolved): TVulcanConfigInput => config;
export type TDoctor = NonNullable<TVulcanConfigInput['doctor']>;
`,
    );
  });

  test('an aliased whole-file type keeps its alias', () => {
    const text = `import type { VulcanConfig as C } from ${PACKAGE};

export default {} satisfies C;
`;

    expect(rewrite({ text })).toBe(text.replace('VulcanConfig as', 'VulcanConfigType as'));
  });

  test('an aliased namespace keeps its alias and gets the group names', () => {
    const text = `import type { VulcanConfig as C } from ${PACKAGE};

export const board = {} satisfies C.Board;
`;

    expect(rewrite({ text })).toBe(text.replace('C.Board', 'C.BoardType'));
  });

  test('an alias used both ways: the alias stays for the namespace, VulcanConfigType is added', () => {
    const text = `import type { VulcanConfig as C } from ${PACKAGE};

export const board = {} satisfies C.Board;
export default { board } satisfies C;
`;

    expect(rewrite({ text })).toBe(
      `import type { VulcanConfig as C, VulcanConfigType } from ${PACKAGE};

export const board = {} satisfies C.BoardType;
export default { board } satisfies VulcanConfigType;
`,
    );
  });

  test('a second run changes nothing', () => {
    for (const files of [SPLIT, { [CONFIG]: BOTH }, { [CONFIG]: FLAT_NAMES }]) {
      expect(ok(run({ files: after({ files }) })).changes).toEqual([]);
    }
  });

  test('--reverse gives back the input, byte for byte', () => {
    const aliased = `import type { VulcanConfig as C } from ${PACKAGE};

export const board = {} satisfies C.Board;
export default { board } satisfies C;
`;

    for (const files of [
      SPLIT,
      { [CONFIG]: SINGLE },
      { [CONFIG]: BOTH },
      { [CONFIG]: FLAT_NAMES },
      { [CONFIG]: aliased },
    ]) {
      const forward = after({ files });

      expect(after({ files: forward, isReverse: true })).toEqual(files);
    }
  });

  test('a file with neither name, or the names of another package, is left alone', () => {
    const files = {
      [CONFIG]: `import { defineConfig } from ${PACKAGE};
import type { VulcanConfig } from './own.mts';

export default defineConfig({} satisfies VulcanConfig);
`,
    };

    expect(run({ files })).toEqual({
      ok: true,
      changes: [],
      notes: ['no config type name to rename: nothing to do'],
    });
    expect(ok(run({ files: {} })).changes).toEqual([]);
  });

  test('a key of the flat shape read from VulcanConfig is left for config-groups, which retypes it', () => {
    const files = {
      [CONFIG]: `import type { VulcanConfig } from ${PACKAGE};
import { claude } from './vulcan/claude.mts';

export default {
  claude,
} satisfies VulcanConfig;
`,
      '.configs/vulcan/claude.mts': `import type { VulcanConfig } from ${PACKAGE};

export const claude = {} satisfies NonNullable<VulcanConfig['claude']>;
`,
    };
    const renamed = ok(run({ files }));

    expect(renamed.changes.map((change) => change.path)).toEqual([CONFIG]);
    expect(renamed.notes.join('\n')).toContain('run `config-groups` first');

    const first = after({ files });
    const grouped = ok(ConfigCodemod.run({ root: process.cwd(), read: (path) => first[path] }));

    expect(
      grouped.changes.find((change) => change.path === '.configs/vulcan/claude.mts')?.text,
    ).toContain("VulcanConfig.AgentType['claude']");
  });

  test('what it cannot rewrite is named in a note, and left as written', () => {
    const cases: [string, string][] = [
      [`export type { VulcanConfig } from ${PACKAGE};\n`, 're-export'],
      [`export type T = import(${PACKAGE}).TFlatConfig;\n`, 'import('],
      [`import type * as v from ${PACKAGE};\nexport type T = v.TFlatConfig;\n`, 'v.TFlatConfig'],
      [`import type { VulcanConfig } from ${PACKAGE};\nexport type { VulcanConfig };\n`, 'exports'],
      [
        `import type { VulcanConfig } from ${PACKAGE};\ntype VulcanConfigType = 1;\nexport default {} satisfies VulcanConfig;\n`,
        'VulcanConfigType',
      ],
      [
        `import type { VulcanConfig } from ${PACKAGE};\nexport type T = VulcanConfig.Other;\n`,
        'VulcanConfig.Other',
      ],
    ];

    for (const [text, expected] of cases) {
      const result = ok(run({ files: { [CONFIG]: text } }));

      expect(result.changes, text).toEqual([]);
      expect(result.notes.join('\n'), text).toContain(expected);
      expect(result.notes[0], text).toStartWith(`${CONFIG}: `);
    }
  });
});

describe('vulcan config codemod config-types', () => {
  const cli = (root: string, args: string[]) =>
    runCli({ args: ['config', 'codemod', 'config-types', ...args], cwd: root });
  const project = () => createProject({ files: { [CONFIG]: SINGLE, 'package.json': '{}' } });
  const read = (root: string) => readFileSync(join(root, CONFIG), 'utf8');

  test('a dry run writes nothing; --write writes; --reverse --write puts it back', () => {
    const root = project();
    const dry = cli(root, ['.']);

    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain(`would write  ${CONFIG}`);
    expect(read(root)).toBe(SINGLE);

    expect(cli(root, ['.', '--write']).code).toBe(0);
    expect(read(root)).toContain('satisfies VulcanConfigType;');
    expect(cli(root, ['.', '--write']).stdout).toContain('nothing to do');

    const dryReverse = cli(root, ['.', '--reverse']);

    expect(dryReverse.code).toBe(0);
    expect(read(root)).toContain('satisfies VulcanConfigType;');
    expect(cli(root, ['.', '--write', '--reverse']).code).toBe(0);
    expect(read(root)).toBe(SINGLE);
  });

  test('--split is refused', () => {
    const result = cli(project(), ['.', '--split']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--split does not apply');
  });
});
