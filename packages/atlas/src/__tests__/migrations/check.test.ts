import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { ChangelogCheck } from '@/migrations';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ITEM = `migration:
  - id: redis-factory
    symbols: [RedisHelperFactory.create]
    upgrade: { before: "RedisHelper.new()", after: "RedisHelperFactory.create()" }
    downgrade: { steps: ["Use RedisHelper.new() again"] }
`;

const BREAKING = '<Badge type="warning" text="Breaking Change" />';
const SHORT_BREAKING = '<Badge type="danger" text="Breaking" />';
const FEATURE = '<Badge type="tip" text="New Feature" />';

/** A project whose changelog folder holds `files`; `migrationFrom` is the cutover, absent for none. */
const projectWith = (opts: { files: Record<string, string>; migrationFrom?: string }) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-check-'));

  roots.push(root);
  mkdirSync(join(root, 'changes'));

  for (const [file, text] of Object.entries(opts.files)) {
    writeFileSync(join(root, 'changes', file), text);
  }

  const knowledge: Record<string, string> = { changelogs: 'changes' };

  if (opts.migrationFrom !== undefined) {
    knowledge.migrationFrom = opts.migrationFrom;
  }

  return {
    root,
    project: ProjectConfig.toAtlasProject({
      root,
      manifest: {
        schemaVersion: 1,
        packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
        knowledge,
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    }),
  };
};

const entry = (opts: { badge: string; extra?: string }): string =>
  `---\ntitle: A change\npackages: ['@a/kernel']\n${opts.extra ?? ''}---\n\n# Changelog - 2026-11-20\n\n${opts.badge}\n`;

describe('ChangelogCheck.scan', () => {
  test('C1: a Breaking Change entry after the cutover without migration names its file', () => {
    const { project } = projectWith({
      files: { '2026-11-20-break.md': entry({ badge: BREAKING }) },
      migrationFrom: '2026-11-13',
    });

    const problems = ChangelogCheck.scan({ project });

    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('2026-11-20-break.md');
    expect(problems[0].message).toContain('migration');
  });

  test('C1: a Breaking Change badge set through the badges field counts too', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-break.md': entry({ badge: '', extra: 'badges: [Breaking Change]\n' }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toHaveLength(1);
  });

  test('the short spelling `Breaking` is breaking too: it owes a block, and is reported as non-canonical', () => {
    const missing = projectWith({
      files: { '2026-11-20-short.md': entry({ badge: SHORT_BREAKING }) },
      migrationFrom: '2026-11-13',
    });
    const present = projectWith({
      files: { '2026-11-20-short.md': entry({ badge: SHORT_BREAKING, extra: ITEM }) },
      migrationFrom: '2026-11-13',
    });
    const owed = ChangelogCheck.scan({ project: missing.project });
    const spelling = ChangelogCheck.scan({ project: present.project });

    expect(owed.map((problem) => problem.message).join('\n')).toContain('`migration:`');
    expect(owed).toHaveLength(2);
    expect(spelling).toHaveLength(1);
    expect(spelling[0].message).toContain('use "Breaking Change"');
    expect(spelling[0].file).toBe('2026-11-20-short.md');
  });

  test('the short spelling in the badges field is breaking and non-canonical too', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-short.md': entry({ badge: '', extra: `badges: [Breaking]\n${ITEM}` }),
      },
      migrationFrom: '2026-11-13',
    });

    const problems = ChangelogCheck.scan({ project });

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('use "Breaking Change"');
  });

  test('the spelling is not reported without a cutover, nor on an entry before it', () => {
    const none = projectWith({
      files: { '2026-11-20-short.md': entry({ badge: SHORT_BREAKING }) },
    });
    const before = projectWith({
      files: { '2026-11-01-short.md': entry({ badge: SHORT_BREAKING }) },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project: none.project })).toEqual([]);
    expect(ChangelogCheck.scan({ project: before.project })).toEqual([]);
  });

  test('a conforming Breaking Change entry passes', () => {
    const { project } = projectWith({
      files: { '2026-11-20-break.md': entry({ badge: BREAKING, extra: ITEM }) },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toEqual([]);
  });

  test('a non-breaking entry needs no migration', () => {
    const { project } = projectWith({
      files: { '2026-11-20-feature.md': entry({ badge: FEATURE }) },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toEqual([]);
  });

  test('with no cutover nothing is required, but a migration block that is present is checked', () => {
    const required = projectWith({ files: { '2026-11-20-break.md': entry({ badge: BREAKING }) } });
    const bad = projectWith({
      files: {
        '2026-11-20-bad.md': entry({
          badge: FEATURE,
          extra: 'migration:\n  - id: x\n    symbols: [A]\n',
        }),
      },
    });

    expect(ChangelogCheck.scan({ project: required.project })).toEqual([]);
    expect(ChangelogCheck.scan({ project: bad.project }).length).toBeGreaterThan(0);
  });

  test('C2: two entries with the same migration id fail, each file named', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({ badge: BREAKING, extra: ITEM }),
        '2026-11-21-b.md': entry({ badge: BREAKING, extra: ITEM }),
      },
      migrationFrom: '2026-11-13',
    });

    const problems = ChangelogCheck.scan({ project });

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('redis-factory');
    expect(problems[0].message).toContain('2026-11-20-a.md');
    expect(problems[0].message).toContain('2026-11-21-b.md');
  });

  test('C2: the same id twice inside one entry fails', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: `${ITEM}${ITEM.replace('migration:\n', '')}`,
        }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toHaveLength(1);
  });

  test('C3.1: an item without downgrade fails', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: `migration:
  - id: x
    symbols: [A]
    upgrade: { steps: ["do it"] }
`,
        }),
      },
      migrationFrom: '2026-11-13',
    });

    const problems = ChangelogCheck.scan({ project });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].message).toContain('downgrade');
  });

  test('C3.2: a downgrade with both shapes fails; an upgrade may hold the steps with the code', () => {
    const check = (opts: { upgrade: string; downgrade: string }) =>
      ChangelogCheck.scan({
        project: projectWith({
          files: {
            '2026-11-20-a.md': entry({
              badge: BREAKING,
              extra: `migration:
  - id: x
    symbols: [A]
    upgrade: ${opts.upgrade}
    downgrade: ${opts.downgrade}
`,
            }),
          },
          migrationFrom: '2026-11-13',
        }).project,
      });

    expect(
      check({ upgrade: '{ steps: ["c"] }', downgrade: '{ before: "a", after: "b", steps: ["d"] }' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      check({
        upgrade: '{ before: "a", after: "b", steps: ["c"] }',
        downgrade: '{ steps: ["d"] }',
      }),
    ).toEqual([]);
  });

  test('an item with no symbols, or a symbol that is not an identifier, fails', () => {
    const none = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: ITEM.replace('[RedisHelperFactory.create]', '[]'),
        }),
      },
      migrationFrom: '2026-11-13',
    });
    const odd = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: ITEM.replace('[RedisHelperFactory.create]', '["a b"]'),
        }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project: none.project }).length).toBeGreaterThan(0);
    expect(ChangelogCheck.scan({ project: odd.project }).length).toBeGreaterThan(0);
  });

  test('a module specifier is a valid symbol', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: ITEM.replace('[RedisHelperFactory.create]', '["@a/kernel/helpers"]'),
        }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toEqual([]);
  });

  test('C4: an entry dated before the cutover is never checked, whatever it holds', () => {
    const { project } = projectWith({
      files: {
        '2026-11-01-old.md': entry({ badge: BREAKING, extra: 'migration:\n  - nonsense\n' }),
        '2026-11-12-old.md': entry({ badge: BREAKING }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toEqual([]);
  });

  test('C4: an entry on the cutover day is checked', () => {
    const { project } = projectWith({
      files: { '2026-11-13-day.md': entry({ badge: BREAKING }) },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toHaveLength(1);
  });

  test('C5: a codemod the list does not hold fails; one it holds passes', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: ITEM.replace('    downgrade', '    codemod: nope\n    downgrade'),
        }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project, codemods: ['namespace-functions'] })).toHaveLength(1);
    expect(ChangelogCheck.scan({ project, codemods: ['nope'] })).toEqual([]);
  });

  test('a codemod name is lower-case words joined by -: anything else, a leading - included, fails', () => {
    for (const name of ['--write', '-x', 'Has Space', 'UPPER', 'a_b', '../x', 'a;b']) {
      const { project } = projectWith({
        files: {
          '2026-11-20-a.md': entry({
            badge: BREAKING,
            extra: ITEM.replace('    downgrade', `    codemod: "${name}"\n    downgrade`),
          }),
        },
        migrationFrom: '2026-11-13',
      });

      expect(ChangelogCheck.scan({ project }).length, name).toBeGreaterThan(0);
    }
  });

  test('C5: with no codemod list the name is not checked', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: ITEM.replace('    downgrade', '    codemod: nope\n    downgrade'),
        }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project })).toEqual([]);
  });

  test('invalid YAML frontmatter is a problem naming the file, not a crash', () => {
    const { project } = projectWith({
      files: { '2026-11-20-a.md': '---\ntitle: [unclosed\n---\n\nbody\n' },
      migrationFrom: '2026-11-13',
    });

    const problems = ChangelogCheck.scan({ project });

    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('2026-11-20-a.md');
  });
});

describe('ChangelogCheck.codemodsOf', () => {
  const withDevz = (opts: { script: string }): string => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-devz-'));

    roots.push(root);
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(root, 'node_modules', '@a', 'tools', 'bin'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '@a', 'tools', 'bin', 'devz'), opts.script);
    chmodSync(join(root, 'node_modules', '@a', 'tools', 'bin', 'devz'), 0o755);
    symlinkSync('../@a/tools/bin/devz', join(root, 'node_modules', '.bin', 'devz'));

    return root;
  };

  test('reads the names `devz codemod --list` prints, one per line', () => {
    const root = withDevz({
      script: '#!/bin/sh\nprintf "namespace-functions\\nconnector-imports\\n"\n',
    });

    expect(ChangelogCheck.codemodsOf({ root, packages: ['@a/tools'] })).toEqual([
      'namespace-functions',
      'connector-imports',
    ]);
  });

  test('is undefined when devz is absent or does not list', () => {
    const empty = mkdtempSync(join(tmpdir(), 'atlas-devz-'));

    roots.push(empty);

    expect(ChangelogCheck.codemodsOf({ root: empty, packages: ['@a/tools'] })).toBeUndefined();
    expect(
      ChangelogCheck.codemodsOf({
        root: withDevz({ script: '#!/bin/sh\nexit 2\n' }),
        packages: ['@a/tools'],
      }),
    ).toBeUndefined();
  });

  test('is undefined, and runs nothing, when the binary is not inside a package the project declares', () => {
    const root = withDevz({ script: '#!/bin/sh\nprintf "namespace-functions\\n"\n' });

    expect(ChangelogCheck.codemodsOf({ root, packages: ['@a/other'] })).toBeUndefined();
    expect(ChangelogCheck.codemodsOf({ root, packages: [] })).toBeUndefined();
  });
});

describe('ChangelogCheck.run', () => {
  test('exits 0 on no problem and 1 on one, printing `file: message` lines', () => {
    const good = projectWith({ files: { '2026-11-20-a.md': entry({ badge: FEATURE }) } });
    const bad = projectWith({
      files: { '2026-11-20-a.md': entry({ badge: BREAKING }) },
      migrationFrom: '2026-11-13',
    });
    const lines: string[] = [];

    const write = (text: string): void => {
      lines.push(text);
    };

    expect(ChangelogCheck.run({ project: good.project, write })).toBe(0);
    expect(ChangelogCheck.run({ project: bad.project, write })).toBe(1);
    expect(lines.join('')).toContain('2026-11-20-a.md');
  });
});

describe('ChangelogCheck.run: a codemod runner that is a package of the workspace', () => {
  /** Prints its codemod's names, and leaves a mark so a test can tell whether it ran. */
  const RUNNER = `require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'ran'), '');
if (process.argv.slice(2).join(' ') === 'codemod --list') console.log('namespace');
else process.exit(2);
`;

  const CODEMOD_ITEM = `${ITEM}    codemod: namespace\n`;

  const workspace = (opts: {
    files?: Record<string, string>;
    bin?: unknown;
    command?: string[];
    item?: string;
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-'));
    const files: Record<string, string> = {
      'changes/2026-11-20-a.md': entry({ badge: FEATURE, extra: opts.item ?? CODEMOD_ITEM }),
      'packages/ardor/package.json': JSON.stringify({
        name: '@a/ardor',
        bin: opts.bin ?? { ardor: './dist/bin.js' },
      }),
      ...(opts.files ?? { 'packages/ardor/dist/bin.js': RUNNER }),
    };

    roots.push(root);

    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }

    const project = ProjectConfig.toAtlasProject({
      root,
      manifest: {
        schemaVersion: 1,
        packages: [
          { name: '@a/kernel', dir: 'kernel', aliases: [], retired: false },
          { name: '@a/ardor', dir: 'ardor', aliases: [], retired: false },
        ],
        knowledge: {
          changelogs: 'changes',
          ...(opts.command === undefined ? {} : { codemodCommand: opts.command }),
        },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });

    const run = (): { code: number; output: string; ran: boolean } => {
      const lines: string[] = [];
      const code = ChangelogCheck.run({ project, write: (text) => lines.push(text) });

      return { code, output: lines.join(''), ran: existsSync(join(root, 'ran')) };
    };

    return { root, run };
  };

  const DECLARED = ['ardor', 'codemod'];

  test('the bin of a declared package lists the names, with nothing in node_modules/.bin', () => {
    const good = workspace({ command: DECLARED }).run();
    const bad = workspace({ command: DECLARED, item: `${ITEM}    codemod: rename\n` }).run();

    expect(good).toEqual({ code: 0, output: '', ran: true });
    expect(bad.code).toBe(1);
    expect(bad.output).toContain("names codemod 'rename'");
  });

  test('a bin written as one string is named after the package', () => {
    const result = workspace({ command: DECLARED, bin: './dist/bin.js' }).run();

    expect(result).toEqual({ code: 0, output: '', ran: true });
  });

  test('a declared command fails when it cannot be found or has not been built', () => {
    const unbuilt = workspace({ command: DECLARED, files: {} }).run();
    const unknown = workspace({ command: ['other', 'codemod'] }).run();
    const noNames = workspace({ command: DECLARED, files: {}, item: ITEM }).run();

    expect(unbuilt.code).toBe(1);
    expect(unbuilt.output).toContain('./dist/bin.js');
    expect(unbuilt.output).toContain('build the package');
    expect(unknown.code).toBe(1);
    expect(unknown.output).toContain("no package of the project declares a bin 'other'");
    expect(noNames.code).toBe(1);
  });

  test('a declared command that cannot list its names fails', () => {
    const result = workspace({ command: ['ardor', 'codemods'] }).run();

    expect(result.code).toBe(1);
    expect(result.output).toContain('exited 2');
  });

  test('with no declared command, a missing runner fails only when an item names a codemod', () => {
    const named = workspace({}).run();
    const unnamed = workspace({ item: ITEM }).run();

    expect(named.code).toBe(1);
    expect(named.output).toContain('devz codemod --list');
    expect(unnamed.code).toBe(0);
    expect(unnamed.output).toContain('codemod names were not checked');
  });

  test('a bin that leaves its package, by path or by link, is never run', () => {
    const byPath = workspace({
      command: DECLARED,
      bin: { ardor: '../../shared.js' },
      files: { 'shared.js': RUNNER },
    }).run();
    const linked = workspace({ command: DECLARED, files: { 'shared.js': RUNNER } });

    mkdirSync(join(linked.root, 'packages/ardor/dist'));
    symlinkSync('../../../shared.js', join(linked.root, 'packages/ardor/dist/bin.js'));

    for (const result of [byPath, linked.run()]) {
      expect(result.code).toBe(1);
      expect(result.ran).toBe(false);
      expect(result.output).toContain('is not inside');
    }
  });

  test('a package folder that is a link out of the project is not used', () => {
    const outside = mkdtempSync(join(tmpdir(), 'atlas-outside-'));

    roots.push(outside);
    mkdirSync(join(outside, 'dist'));
    writeFileSync(join(outside, 'dist/bin.js'), RUNNER);
    writeFileSync(
      join(outside, 'package.json'),
      JSON.stringify({ name: '@a/ardor', bin: { ardor: './dist/bin.js' } }),
    );

    const made = workspace({ command: DECLARED, files: {} });

    rmSync(join(made.root, 'packages/ardor'), { recursive: true });
    symlinkSync(outside, join(made.root, 'packages/ardor'));

    const result = made.run();

    expect(result.code).toBe(1);
    expect(result.ran).toBe(false);
  });

  test('a folder whose package.json has another name is not the declared package', () => {
    const made = workspace({ command: DECLARED });

    writeFileSync(
      join(made.root, 'packages/ardor/package.json'),
      JSON.stringify({ name: '@a/other', bin: { ardor: './dist/bin.js' } }),
    );

    const result = made.run();

    expect(result.code).toBe(1);
    expect(result.ran).toBe(false);
  });

  test('a bin in node_modules/.bin wins: refused there, the workspace one is not tried', () => {
    const made = workspace({
      command: DECLARED,
      files: { 'packages/ardor/dist/bin.js': RUNNER, 'shared.js': RUNNER },
    });

    mkdirSync(join(made.root, 'node_modules/.bin'), { recursive: true });
    symlinkSync('../../shared.js', join(made.root, 'node_modules/.bin/ardor'));

    const result = made.run();

    expect(result.code).toBe(1);
    expect(result.ran).toBe(false);
    expect(result.output).toContain('it is not run');
  });
});
