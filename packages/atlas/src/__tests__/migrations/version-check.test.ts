import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { ChangelogCheck, ChangelogHistory } from '@/migrations';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const BLOCK = `  symbols: [Thing.make]
  upgrade: { before: "Thing.make()", after: "ThingFactory.build()" }
  downgrade: { steps: ["Use Thing.make() again"] }
`;

const log = (opts: { version: string; released?: string; body: string }): string =>
  `---\ntitle: ${opts.version}\nversion: ${opts.version}\npackages: ['@a/kernel']\n${opts.released === undefined ? '' : `released: ${opts.released}\n`}---\n${opts.body}`;

interface IFolderFiles {
  log: string;
  migration?: string;
}

/** A project whose changelog folder holds `folders` (version folders) and `dated` files; `version` is the installable package's version. */
const projectWith = (opts: {
  folders?: Record<string, IFolderFiles>;
  dated?: Record<string, string>;
  migrationFrom?: string;
  datedUntil?: string;
  version?: string;
}) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-version-check-'));

  roots.push(root);
  mkdirSync(join(root, 'changes'));
  mkdirSync(join(root, 'packages', 'kernel'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'kernel', 'package.json'),
    JSON.stringify({ name: '@a/kernel', version: opts.version ?? '0.4.2-3' }),
  );

  for (const [name, files] of Object.entries(opts.folders ?? {})) {
    mkdirSync(join(root, 'changes', name));
    writeFileSync(join(root, 'changes', name, 'log.md'), files.log);

    if (files.migration !== undefined) {
      writeFileSync(join(root, 'changes', name, 'migration.yaml'), files.migration);
    }
  }

  for (const [file, text] of Object.entries(opts.dated ?? {})) {
    writeFileSync(join(root, 'changes', file), text);
  }

  const knowledge: Record<string, string> = { changelogs: 'changes' };

  if (opts.migrationFrom !== undefined) {
    knowledge.migrationFrom = opts.migrationFrom;
  }

  if (opts.datedUntil !== undefined) {
    knowledge.datedUntil = opts.datedUntil;
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

const problemsOf = (opts: Parameters<typeof projectWith>[0]): string[] =>
  ChangelogCheck.scan({ project: projectWith(opts).project }).map(
    (problem) => `${problem.file}: ${problem.message}`,
  );

const BREAKING_LOG = log({
  version: '0.4.2',
  body: '\n## Breaking\n- **Factory only** `thing-factory` (`@a/kernel`): call the factory.\n\n## Added\n- **A flag** `a-flag`: new.\n',
});

describe('the version folder gate: blocks and ids (C1, C2)', () => {
  test('C1: a Breaking item with its block, and an Added item with none, is valid', () => {
    expect(
      problemsOf({
        folders: { '0.4.2': { log: BREAKING_LOG, migration: `thing-factory:\n${BLOCK}` } },
        version: '0.4.2-3',
      }),
    ).toEqual([]);
  });

  test('C1: a Breaking or Deprecated id with no block names folder and id', () => {
    const deprecated = log({
      version: '0.4.2',
      body: '\n## Deprecated\n- **Old call** `old-call`: use the new one.\n',
    });

    for (const [text, id] of [
      [BREAKING_LOG, 'thing-factory'],
      [deprecated, 'old-call'],
    ]) {
      const found = problemsOf({ folders: { '0.4.2': { log: text } } });

      expect(
        found.some((line) => line.startsWith('0.4.2/migration.yaml:') && line.includes(id)),
      ).toBe(true);
    }
  });

  test('C1: a block with no item in log.md, or for an Added item, fails', () => {
    const found = problemsOf({
      folders: {
        '0.4.2': {
          log: BREAKING_LOG,
          migration: `thing-factory:\n${BLOCK}ghost:\n${BLOCK}a-flag:\n${BLOCK}`,
        },
      },
    });

    expect(found.some((line) => line.includes("'ghost' has a block but no item in log.md"))).toBe(
      true,
    );
    expect(
      found.some((line) => line.includes("'a-flag' is not a Breaking or Deprecated item")),
    ).toBe(true);
  });

  test('C2: an id twice in log.md, a key twice in migration.yaml, and a bad block each fail', () => {
    const twice = log({
      version: '0.4.2',
      body: '\n## Added\n- **One** `same-id`: a.\n- **Two** `same-id`: b.\n',
    });
    const found = problemsOf({
      folders: {
        '0.4.2': { log: twice },
        '0.4.3': {
          log: log({ version: '0.4.3', body: '\n## Breaking\n- **X** `x-item`: x.\n' }),
          migration: `x-item:\n${BLOCK}x-item:\n${BLOCK}`,
        },
        '0.4.4': {
          log: log({ version: '0.4.4', body: '\n## Breaking\n- **Y** `y-item`: y.\n' }),
          migration: 'y-item:\n  symbols: []\n',
        },
      },
    });

    expect(
      found.some(
        (line) => line.startsWith('0.4.2/log.md') && line.includes("'same-id' is used twice"),
      ),
    ).toBe(true);
    expect(
      found.some(
        (line) =>
          line.startsWith('0.4.3/migration.yaml') && line.includes("'x-item' is used 2 times"),
      ),
    ).toBe(true);
    expect(
      found.some((line) => line.startsWith('0.4.4/migration.yaml') && line.includes('y-item.')),
    ).toBe(true);
  });

  test('C2: sections out of order, an unknown section, a name that is not the version fail', () => {
    const found = problemsOf({
      folders: {
        '0.4.2': {
          log: log({
            version: '0.4.2',
            body: '\n## Added\n- **A** `a-item`: a.\n\n## Breaking\n- **B** `b-item`: b.\n',
          }),
          migration: `b-item:\n${BLOCK}`,
        },
        '0.4.3': { log: log({ version: '0.4.3', body: '\n## Removed\n- **R** `r-item`: r.\n' }) },
        '0.4.4': { log: log({ version: '0.4.5', body: '\n## Added\n- **A** `a-item`: a.\n' }) },
      },
    });

    expect(found.some((line) => line.includes("section 'Breaking' is out of order"))).toBe(true);
    expect(found.some((line) => line.includes("section 'Removed' is not one of"))).toBe(true);
    expect(found.some((line) => line.includes("version: must be '0.4.4'"))).toBe(true);
  });

  test('C13: no migration.yaml, an empty one and `{}` all mean no blocks; a log with no items is valid', () => {
    const added = log({ version: '0.4.2', body: '\nNo change for users.\n' });

    for (const migration of [undefined, '', '{}\n']) {
      expect(problemsOf({ folders: { '0.4.2': { log: added, migration } } })).toEqual([]);
    }
  });
});

describe('the version folder gate: the line in progress (C3)', () => {
  const folder = (opts: { version: string; released?: string }): IFolderFiles => ({
    log: log({
      version: opts.version,
      released: opts.released,
      body: '\n## Added\n- **A** `a-item`: a.\n',
    }),
  });

  test('C3: two folders without released fail; one in progress above the released ones is valid', () => {
    const two = problemsOf({
      folders: { '0.4.1': folder({ version: '0.4.1' }), '0.4.2': folder({ version: '0.4.2' }) },
      version: '0.4.2-1',
    });

    expect(
      two.some((line) => line.includes('more than one version folder has no `released:`')),
    ).toBe(true);
    expect(
      problemsOf({
        folders: {
          '0.4.1': folder({ version: '0.4.1', released: '2026-11-01' }),
          '0.4.2': folder({ version: '0.4.2' }),
        },
        version: '0.4.2-1',
      }),
    ).toEqual([]);
  });

  test('C3: an in-progress folder not above a released one fails', () => {
    const found = problemsOf({
      folders: {
        '0.4.1': folder({ version: '0.4.1' }),
        '0.4.2': folder({ version: '0.4.2', released: '2026-11-01' }),
      },
      version: '0.4.1-1',
    });

    expect(found.some((line) => line.includes('is in progress but 0.4.2 is released'))).toBe(true);
  });

  test('C3: the in-progress folder must be the stable the installable package heads to', () => {
    const wrong = problemsOf({
      folders: { '0.4.2': folder({ version: '0.4.2' }) },
      version: '0.4.3-1',
    });
    const missing = problemsOf({
      folders: { '0.4.1': folder({ version: '0.4.1', released: '2026-11-01' }) },
      version: '0.4.3-1',
    });

    expect(wrong.some((line) => line.includes('heading to 0.4.3'))).toBe(true);
    expect(missing.some((line) => line.includes('its line 0.4.3 needs a version folder'))).toBe(
      true,
    );
  });

  test('C3: a bad released date fails', () => {
    const found = problemsOf({
      folders: { '0.4.2': folder({ version: '0.4.2', released: 'yesterday' }) },
    });

    expect(found.some((line) => line.includes('released: must be a date'))).toBe(true);
  });
});

describe('dated files in dual mode (C16)', () => {
  const dated =
    '---\ntitle: T\npackages: [\'@a/kernel\']\n---\n\n# Changelog - 2026-11-20\n\n<Badge type="warning" text="Breaking Change" />\n';

  test('a version cutover retires the dated files: a Breaking one without a block is history', () => {
    expect(problemsOf({ dated: { '2026-11-20-break.md': dated }, migrationFrom: '0.4.5' })).toEqual(
      [],
    );
    expect(
      problemsOf({ dated: { '2026-11-20-break.md': dated }, migrationFrom: '2026-11-13' }),
    ).toHaveLength(1);
  });

  test('C16: a dated file after datedUntil fails; one on or before it does not', () => {
    const found = problemsOf({
      dated: { '2026-11-20-break.md': dated },
      migrationFrom: '0.4.5',
      datedUntil: '2026-11-14',
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('changelogs/<X.Y.Z>/log.md');
    expect(
      problemsOf({
        dated: { '2026-11-20-break.md': dated },
        migrationFrom: '0.4.5',
        datedUntil: '2026-11-20',
      }),
    ).toEqual([]);
  });
});

const run = (opts: { root: string; args: string[] }): string =>
  spawnSync('git', opts.args, { cwd: opts.root, encoding: 'utf8' }).stdout;

describe('the history gate (C4)', () => {
  const released = log({
    version: '0.4.1',
    released: '2026-11-01',
    body: '\n## Added\n- **A** `a-item`: a.\n',
  });

  const repo = () => {
    const made = projectWith({ folders: { '0.4.1': { log: released } }, migrationFrom: '0.4.1' });

    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 't@t.t'],
      ['config', 'user.name', 't'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'base'],
      ['tag', 'kernel-v0.4.1'],
    ]) {
      run({ root: made.root, args });
    }

    return made;
  };

  const history = (opts: { made: ReturnType<typeof repo> }): string[] =>
    ChangelogHistory.scan({ project: opts.made.project, base: 'HEAD' }).map(
      (problem) => `${problem.file}: ${problem.message}`,
    );

  test('C4: nothing changed since the base is clean', () => {
    expect(history({ made: repo() })).toEqual([]);
  });

  test('C4: a released folder that changed is frozen; a new folder is accepted', () => {
    const made = repo();

    writeFileSync(join(made.root, 'changes', '0.4.1', 'log.md'), `${released}\nmore\n`);
    mkdirSync(join(made.root, 'changes', '0.4.2'));
    writeFileSync(
      join(made.root, 'changes', '0.4.2', 'log.md'),
      log({ version: '0.4.2', body: '\n## Added\n- **B** `b-item`: b.\n' }),
    );

    const found = history({ made });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('0.4.1 was released at HEAD and is frozen');
  });

  test('C4: a dated file added after the base fails', () => {
    const made = repo();

    writeFileSync(
      join(made.root, 'changes', '2026-11-20-new.md'),
      '---\ntitle: T\npackages: []\n---\n',
    );

    expect(history({ made }).some((line) => line.includes('a dated entry added or edited'))).toBe(
      true,
    );
  });

  test('C4: a stable tag at or above the cutover with no folder fails', () => {
    const made = repo();

    run({ root: made.root, args: ['tag', 'kernel-v0.4.2'] });

    expect(
      history({ made }).some(
        (line) => line.startsWith('0.4.2/log.md') && line.includes('has no version folder'),
      ),
    ).toBe(true);
  });

  test('a base that is not a commit is reported', () => {
    const made = repo();
    const found = ChangelogHistory.scan({ project: made.project, base: 'no-such-ref' });

    expect(found[0].message).toContain('not a commit');
  });
});
