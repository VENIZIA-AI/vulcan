import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('C3.2: an upgrade with both shapes fails', () => {
    const { project } = projectWith({
      files: {
        '2026-11-20-a.md': entry({
          badge: BREAKING,
          extra: `migration:
  - id: x
    symbols: [A]
    upgrade: { before: "a", after: "b", steps: ["c"] }
    downgrade: { steps: ["d"] }
`,
        }),
      },
      migrationFrom: '2026-11-13',
    });

    expect(ChangelogCheck.scan({ project }).length).toBeGreaterThan(0);
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
    writeFileSync(join(root, 'node_modules', '.bin', 'devz'), opts.script);
    chmodSync(join(root, 'node_modules', '.bin', 'devz'), 0o755);

    return root;
  };

  test('reads the names `devz codemod --list` prints, one per line', () => {
    const root = withDevz({
      script: '#!/bin/sh\nprintf "namespace-functions\\nconnector-imports\\n"\n',
    });

    expect(ChangelogCheck.codemodsOf({ root })).toEqual([
      'namespace-functions',
      'connector-imports',
    ]);
  });

  test('is undefined when devz is absent or does not list', () => {
    const empty = mkdtempSync(join(tmpdir(), 'atlas-devz-'));

    roots.push(empty);

    expect(ChangelogCheck.codemodsOf({ root: empty })).toBeUndefined();
    expect(
      ChangelogCheck.codemodsOf({ root: withDevz({ script: '#!/bin/sh\nexit 2\n' }) }),
    ).toBeUndefined();
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
