import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { VersionFolders } from '@/changelogs/version-folder';
import { ChangelogCheck, ChangelogHistory } from '@/migrations';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const BLOCK = `  symbols: [Thing.make]
  upgrade: { before: "Thing.make()", after: "ThingFactory.build()", steps: ["Replace Thing.make with ThingFactory.build"] }
  downgrade: { steps: ["Use Thing.make() again"] }
`;

/**
 * A `log.md`. A folder without `released:` owes a summary and highlights: they are written unless `null` says not to
 * (a released folder owes neither, and gets none).
 */
const log = (opts: {
  version: string;
  released?: string;
  body: string;
  summary?: string | null;
  highlights?: string[] | null;
}): string => {
  const owes = opts.released === undefined;
  const summary = opts.summary === undefined ? (owes ? 'A release.' : null) : opts.summary;
  const highlights =
    opts.highlights === undefined ? (owes ? ['One thing changed'] : null) : opts.highlights;

  return `---\ntitle: ${opts.version}\nversion: ${opts.version}\npackages: ['@a/kernel']\n${summary === null ? '' : `summary: ${summary}\n`}${highlights === null ? '' : `highlights:\n${highlights.map((line) => `  - ${line}`).join('\n')}\n`}${opts.released === undefined ? '' : `released: ${opts.released}\n`}---\n${opts.body}`;
};

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
    expect(
      problemsOf({
        dated: { '2026-11-20-break.md': dated },
        migrationFrom: '0.4.5',
        version: '0.4.4',
      }),
    ).toEqual([]);
    expect(
      problemsOf({ dated: { '2026-11-20-break.md': dated }, migrationFrom: '2026-11-13' }),
    ).toHaveLength(1);
  });

  test('C16: a dated file after datedUntil fails; one on or before it does not', () => {
    const found = problemsOf({
      dated: { '2026-11-20-break.md': dated },
      migrationFrom: '0.4.5',
      datedUntil: '2026-11-14',
      version: '0.4.4',
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('changelogs/<X.Y.Z>/log.md');
    expect(
      problemsOf({
        dated: { '2026-11-20-break.md': dated },
        migrationFrom: '0.4.5',
        datedUntil: '2026-11-20',
        version: '0.4.4',
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

  const repo = (opts: { datedUntil?: string } = {}) => {
    const made = projectWith({
      folders: { '0.4.1': { log: released } },
      migrationFrom: '0.4.1',
      datedUntil: opts.datedUntil,
    });

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

  describe('the display keys of a released folder', () => {
    const logPath = (made: ReturnType<typeof repo>): string =>
      join(made.root, 'changes', '0.4.1', 'log.md');

    test('adding or editing summary and highlights is not a change of the release', () => {
      const made = repo();

      writeFileSync(
        logPath(made),
        released.replace(
          'released: 2026-11-01',
          'summary: What it is.\nhighlights:\n  - One\n  - Two\nreleased: 2026-11-01',
        ),
      );
      expect(history({ made })).toEqual([]);

      writeFileSync(
        logPath(made),
        released.replace(
          'released: 2026-11-01',
          'highlights:\n  - Three\nsummary: Another sentence.\nreleased: 2026-11-01',
        ),
      );
      expect(history({ made })).toEqual([]);
    });

    test('an item, the released date, the body or migration.yaml still freeze the folder', () => {
      for (const change of [
        (made: ReturnType<typeof repo>) =>
          writeFileSync(logPath(made), released.replace('a.', 'changed.')),
        (made: ReturnType<typeof repo>) =>
          writeFileSync(logPath(made), released.replace('2026-11-01', '2026-11-02')),
        (made: ReturnType<typeof repo>) =>
          writeFileSync(
            logPath(made),
            released
              .replace('released: 2026-11-01', 'summary: S.\nreleased: 2026-11-01')
              .replace('a-item', 'b-item'),
          ),
        (made: ReturnType<typeof repo>) =>
          writeFileSync(
            join(made.root, 'changes', '0.4.1', 'migration.yaml'),
            'x:\n  symbols: [A]\n',
          ),
      ]) {
        const made = repo();

        change(made);
        expect(history({ made }).join('\n')).toContain('0.4.1 was released at HEAD and is frozen');
      }
    });

    test('a summary edit plus a body edit is still a change', () => {
      const made = repo();

      writeFileSync(
        logPath(made),
        `${released.replace('released: 2026-11-01', 'summary: S.\nreleased: 2026-11-01')}\nmore\n`,
      );
      expect(history({ made }).join('\n')).toContain('is frozen');
    });
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

  test('C4: a dated file on or before datedUntil is the old changelog, not a new entry; a later one still fails', () => {
    const made = repo({ datedUntil: '2026-11-14' });

    for (const name of ['2026-11-13-old.md', '2026-11-14-last.md', '2026-11-20-new.md']) {
      writeFileSync(join(made.root, 'changes', name), '---\ntitle: T\npackages: []\n---\n');
    }

    const found = history({ made }).filter((line) =>
      line.includes('a dated entry added or edited'),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith('2026-11-20-new.md');
  });

  test('C4: with no datedUntil every dated file added since the base fails', () => {
    const made = repo();

    for (const name of ['2026-11-13-old.md', '2026-11-20-new.md']) {
      writeFileSync(join(made.root, 'changes', name), '---\ntitle: T\npackages: []\n---\n');
    }

    expect(
      history({ made }).filter((line) => line.includes('a dated entry added or edited')),
    ).toHaveLength(2);
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

describe('findings of the review of the gate', () => {
  test('a bullet with no id, in any section, is a problem naming its line in the file', () => {
    const text = log({
      version: '0.4.2',
      body: '\n## Breaking\n- **Removed Foo**: Foo is gone.\n',
    });
    const found = problemsOf({ folders: { '0.4.2': { log: text } } });

    expect(found.some((line) => line.includes('line 11: an item reads'))).toBe(true);
  });

  test('a project that adopted the folders and is on a prerelease with none is told its line needs one', () => {
    const found = problemsOf({ migrationFrom: '0.4.5', version: '0.4.5-0' });

    expect(found.some((line) => line.includes('its line 0.4.5 needs a version folder'))).toBe(true);
    expect(problemsOf({ version: '0.4.5-0' })).toEqual([]);
  });

  test('a quoted key repeats a bare one in migration.yaml', () => {
    const body = '\n## Breaking\n- **X** `thing-factory`: x.\n';
    const found = problemsOf({
      folders: {
        '0.4.2': {
          log: log({ version: '0.4.2', body }),
          migration: `thing-factory:\n${BLOCK}"thing-factory":\n${BLOCK}`,
        },
      },
    });

    expect(found.some((line) => line.includes("'thing-factory' is used 2 times"))).toBe(true);
  });

  test('an unreadable package.json is a problem, not a silent pass', () => {
    const made = projectWith({
      folders: { '0.4.2': { log: BREAKING_LOG, migration: `thing-factory:\n${BLOCK}` } },
    });

    writeFileSync(join(made.root, 'packages', 'kernel', 'package.json'), '{ not json');

    const found = ChangelogCheck.scan({ project: made.project });

    expect(found.some((problem) => problem.message.includes('cannot read the version'))).toBe(true);
  });
});

describe('the history gate: dual mode and edge cases', () => {
  const dated = '---\ntitle: T\npackages: []\n---\n';

  test('a project on a date cutover may add dated files: --history does not refuse them', () => {
    const made = projectWith({ migrationFrom: '2026-11-13' });

    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 't@t.t'],
      ['config', 'user.name', 't'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'base'],
    ]) {
      run({ root: made.root, args });
    }

    writeFileSync(join(made.root, 'changes', '2026-11-14-feat.md'), dated);

    expect(ChangelogHistory.scan({ project: made.project, base: 'HEAD' })).toEqual([]);
  });

  test('a renamed-in dated file fails, a dated file in a nested folder does not', () => {
    const made = projectWith({ migrationFrom: '0.4.5', version: '0.4.4' });

    writeFileSync(join(made.root, 'changes', 'notes.md'), dated);

    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 't@t.t'],
      ['config', 'user.name', 't'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'base'],
      ['mv', 'changes/notes.md', 'changes/2026-11-20-new.md'],
    ]) {
      run({ root: made.root, args });
    }

    mkdirSync(join(made.root, 'changes', 'archive'));
    writeFileSync(join(made.root, 'changes', 'archive', '2026-11-20-old.md'), dated);

    const found = ChangelogHistory.scan({ project: made.project, base: 'HEAD' }).map(
      (problem) => problem.file,
    );

    expect(found).toEqual(['2026-11-20-new.md']);
  });
});

describe('the codemod runner of the project', () => {
  test('a project that declares its own runner has its names listed by it, never by devz', () => {
    const made = projectWith({});

    mkdirSync(join(made.root, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(made.root, 'node_modules', '@a', 'ardor', 'bin'), { recursive: true });
    writeFileSync(
      join(made.root, 'node_modules', '@a', 'ardor', 'bin', 'ardor'),
      '#!/bin/sh\n[ "$1" = codemod ] && [ "$2" = --list ] && echo namespace && echo rename\n',
      { mode: 0o755 },
    );
    symlinkSync('../@a/ardor/bin/ardor', join(made.root, 'node_modules', '.bin', 'ardor'));

    expect(
      ChangelogCheck.codemodsOf({
        root: made.root,
        command: ['ardor', 'codemod'],
        packages: ['@a/ardor'],
      }),
    ).toEqual(['namespace', 'rename']);
    expect(ChangelogCheck.codemodsOf({ root: made.root, packages: ['@a/ardor'] })).toBeUndefined();
  });
});

describe('review round 2: a moved base, a strict runner, parser edges', () => {
  const dated = '---\ntitle: T\npackages: []\n---\n';
  const releasedLog = (opts: { released?: string }): string =>
    log({
      version: '0.4.1',
      released: opts.released,
      body: '\n## Added\n- **A** `a-item`: a.\n',
    });

  const git = (opts: { root: string; args: string[] }): void => {
    for (const args of [opts.args]) {
      run({ root: opts.root, args });
    }
  };

  const initRepo = (opts: { root: string }): void => {
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 't@t.t'],
      ['config', 'user.name', 't'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'base'],
    ]) {
      git({ root: opts.root, args });
    }
  };

  test('a base that moved ahead: a release the base gained since the branch point is not the branch', () => {
    const made = projectWith({
      folders: { '0.4.1': { log: releasedLog({}) } },
      migrationFrom: '0.4.1',
      version: '0.4.1',
    });

    initRepo({ root: made.root });
    git({ root: made.root, args: ['checkout', '-q', '-b', 'feature'] });
    writeFileSync(join(made.root, 'packages', 'kernel', 'note.txt'), 'work\n');
    git({ root: made.root, args: ['add', '-A'] });
    git({ root: made.root, args: ['commit', '-q', '-m', 'feature work'] });
    git({ root: made.root, args: ['checkout', '-q', 'main'] });
    writeFileSync(
      join(made.root, 'changes', '0.4.1', 'log.md'),
      releasedLog({ released: '2026-11-10' }),
    );
    git({ root: made.root, args: ['commit', '-q', '-am', 'promote 0.4.1'] });
    git({ root: made.root, args: ['checkout', '-q', 'feature'] });

    expect(ChangelogHistory.scan({ project: made.project, base: 'main' })).toEqual([]);
  });

  test('a released folder the branch edits is frozen, and one it deletes too', () => {
    const made = projectWith({
      folders: { '0.4.1': { log: releasedLog({ released: '2026-11-10' }) } },
      migrationFrom: '0.4.1',
      version: '0.4.1',
    });

    initRepo({ root: made.root });
    rmSync(join(made.root, 'changes', '0.4.1'), { recursive: true });

    const found = ChangelogHistory.scan({ project: made.project, base: 'HEAD' });

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('0.4.1 was released');
  });

  test('a dated file deleted after the cutover is allowed', () => {
    const made = projectWith({
      dated: { '2026-11-01-old.md': dated },
      migrationFrom: '0.4.5',
      version: '0.4.4',
    });

    initRepo({ root: made.root });
    rmSync(join(made.root, 'changes', '2026-11-01-old.md'));

    expect(ChangelogHistory.scan({ project: made.project, base: 'HEAD' })).toEqual([]);
  });

  test('a base that looks like an option is a ref, never a flag', () => {
    const made = projectWith({ migrationFrom: '0.4.5', version: '0.4.4' });

    initRepo({ root: made.root });

    const found = ChangelogHistory.scan({ project: made.project, base: '--output=oops' });

    expect(found[0].message).toContain('not a commit');
  });

  test('a codemodCommand word that is not allowed throws and names the word', () => {
    const manifest = (command: unknown) => ({
      schemaVersion: 1,
      packages: [],
      knowledge: { changelogs: 'changes', codemodCommand: command },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    });

    const cases: Array<[unknown[], string]> = [
      [['./x'], './x'],
      [['sh', '-c', 'x y'], '-c'],
      [['ardor', ''], '""'],
      [['devz', 7], '7'],
    ];

    for (const [command, word] of cases) {
      expect(() =>
        ProjectConfig.toAtlasProject({ root: '/tmp/x', manifest: manifest(command) }),
      ).toThrow(word);
    }

    expect(() => ProjectConfig.toAtlasProject({ root: '/tmp/x', manifest: manifest([]) })).toThrow(
      'non-empty',
    );
    expect(
      ProjectConfig.toAtlasProject({ root: '/tmp/x', manifest: manifest(['ardor', 'codemod']) })
        .knowledge.codemodCommand,
    ).toEqual(['ardor', 'codemod']);
  });

  test('the messages name the configured runner, not devz', () => {
    const made = projectWith({
      folders: {
        '0.4.2': {
          log: BREAKING_LOG,
          migration: `thing-factory:\n${BLOCK}  codemod: missing-one\n`,
        },
      },
    });
    const project = ProjectConfig.toAtlasProject({
      root: made.root,
      manifest: {
        schemaVersion: 1,
        packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
        knowledge: { changelogs: 'changes', codemodCommand: ['ardor', 'codemod'] },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });
    const found = ChangelogCheck.scan({ project, codemods: ['namespace'] }).map(
      (problem) => problem.message,
    );

    expect(found.some((message) => message.includes('`ardor codemod --list`'))).toBe(true);
    expect(found.some((message) => message.includes('devz'))).toBe(false);
  });

  test('a codemod name the runner does not list fails in the folder gate', () => {
    const found = ChangelogCheck.scan({
      project: projectWith({
        folders: {
          '0.4.2': {
            log: BREAKING_LOG,
            migration: `thing-factory:\n${BLOCK}  codemod: missing-one\n`,
          },
        },
      }).project,
      codemods: ['namespace'],
    });

    expect(
      found.some(
        (problem) =>
          problem.file === '0.4.2/migration.yaml' && problem.message.includes('missing-one'),
      ),
    ).toBe(true);
  });

  test('a Deprecated item with no block fails; with one it passes', () => {
    const text = log({
      version: '0.4.2',
      body: '\n## Deprecated\n- **Old call** `old-call`: use the new one.\n',
    });

    expect(problemsOf({ folders: { '0.4.2': { log: text } } })).toHaveLength(1);
    expect(
      problemsOf({
        folders: { '0.4.2': { log: text, migration: `old-call:\n${BLOCK}` } },
        version: '0.4.2-3',
      }),
    ).toEqual([]);
  });

  test('a fenced block shows an example: its bullets and headings are not items or sections', () => {
    const text = log({
      version: '0.4.2',
      body: '\n## Added\n- **A flag** `a-flag`: new.\n\n```md\n## Breaking\n- **Shown** `shown-item`: an example.\n```\n',
    });

    expect(problemsOf({ folders: { '0.4.2': { log: text } }, version: '0.4.2-3' })).toEqual([]);
  });

  test('a malformed id or an unknown section is reported once, not again as a block with no item', () => {
    const badId = log({
      version: '0.4.2',
      body: '\n## Breaking\n- **Bad** `Bad_Id`: x.\n',
    });
    const badSection = log({
      version: '0.4.2',
      body: '\n## Breaking changes\n- **Odd** `odd-item`: x.\n',
    });

    expect(
      problemsOf({ folders: { '0.4.2': { log: badId, migration: `Bad_Id:\n${BLOCK}` } } }),
    ).toHaveLength(1);
    expect(
      problemsOf({ folders: { '0.4.2': { log: badSection, migration: `odd-item:\n${BLOCK}` } } }),
    ).toHaveLength(2);
  });

  test('an invalid released date is reported once and the folder is not counted as in progress', () => {
    const found = problemsOf({
      folders: {
        '0.4.1': { log: releasedLog({ released: 'yesterday' }) },
        '0.4.2': {
          log: log({ version: '0.4.2', body: '\n## Added\n- **B** `b-item`: b.\n' }),
        },
      },
      version: '0.4.2-3',
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('released: must be a date');
  });
});

describe('review round 3: the parser', () => {
  test('an item that names a package the project does not declare fails, naming it', () => {
    const found = problemsOf({
      folders: {
        '0.4.2': {
          log: log({
            version: '0.4.2',
            body: '\n## Added\n- **One** `one` (`@a/nope`): first.\n',
          }),
        },
      },
      version: '0.4.2-3',
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("'@a/nope'");
  });

  test('a longer fence is closed only by a fence of its own kind and length', () => {
    const folder = VersionFolders.parse({
      name: '0.4.2',
      log: log({
        version: '0.4.2',
        body: '\n## Added\n- **One** `one`: first.\n\n````md\n```\n- **Fake** `fake`: in the example.\n```\n````\n\n- **Two** `two`: second.\n',
      }),
    });

    expect(folder.items.map((item) => item.id)).toEqual(['one', 'two']);
    expect(folder.items[0].body).toContain('- **Fake** `fake`');
  });

  test('a repeated id is reported once and yields one item', () => {
    const folder = VersionFolders.parse({
      name: '0.4.2',
      log: log({
        version: '0.4.2',
        body: '\n## Added\n- **One** `one`: first.\n- **Again** `one`: second.\n',
      }),
    });

    expect(folder.items.map((item) => item.title)).toEqual(['One']);
    expect(folder.problems).toHaveLength(1);
  });
});

describe('the version folder gate: summary, highlights and upgrade.steps (changelog reading)', () => {
  const ADDED = '\n## Added\n- **A** `a-item`: a.\n';
  const FIVE = ['One', 'Two', 'Three', 'Four', 'Five'];
  const found = (opts: { log: string; migration?: string; version?: string }): string[] =>
    problemsOf({
      folders: { '0.4.2': { log: opts.log, migration: opts.migration } },
      // a package on a stable has no line in progress: its released folder stands alone
      version: opts.version ?? (opts.log.includes('released:') ? '0.4.2' : '0.4.2-3'),
    });

  test('an in-progress folder with a summary and one to five highlights is valid', () => {
    expect(found({ log: log({ version: '0.4.2', body: ADDED }) })).toEqual([]);
    expect(found({ log: log({ version: '0.4.2', body: ADDED, highlights: FIVE }) })).toEqual([]);
  });

  test('a summary is required, one line, at most 200 characters', () => {
    for (const summary of [null, 'x'.repeat(201), '"two\\nlines"']) {
      const problems = found({ log: log({ version: '0.4.2', body: ADDED, summary }) });

      expect(
        problems.some((line) => line.startsWith('0.4.2/log.md:') && line.includes('summary')),
      ).toBe(true);
    }

    expect(
      found({ log: log({ version: '0.4.2', body: ADDED, summary: 'x'.repeat(200) }) }),
    ).toEqual([]);
  });

  test('highlights are required, five at most, one line of at most 110 characters each', () => {
    for (const highlights of [null, [], [...FIVE, 'Six'], ['y'.repeat(111)]]) {
      const problems = found({ log: log({ version: '0.4.2', body: ADDED, highlights }) });

      expect(
        problems.some((line) => line.startsWith('0.4.2/log.md:') && line.includes('highlights')),
      ).toBe(true);
    }

    expect(
      found({ log: log({ version: '0.4.2', body: ADDED, highlights: ['y'.repeat(110)] }) }),
    ).toEqual([]);
  });

  test('a folder of three or more items needs at least three highlights', () => {
    const three = '\n## Added\n- **A** `a-item`: a.\n- **B** `b-item`: b.\n- **C** `c-item`: c.\n';

    expect(
      found({ log: log({ version: '0.4.2', body: three, highlights: ['One', 'Two'] }) }).some(
        (line) => line.includes('highlights'),
      ),
    ).toBe(true);
    expect(
      found({ log: log({ version: '0.4.2', body: three, highlights: ['One', 'Two', 'Three'] }) }),
    ).toEqual([]);
  });

  test('a released folder owes none of it, and a malformed one is still reported', () => {
    const released = log({ version: '0.4.2', released: '2026-11-01', body: ADDED });

    expect(found({ log: released })).toEqual([]);
    expect(
      found({ log: released.replace('released:', 'highlights: not-a-list\nreleased:') }).some(
        (line) => line.includes('highlights'),
      ),
    ).toBe(true);
  });

  test('every block of an in-progress folder needs upgrade.steps; a released folder does not', () => {
    const body = '\n## Breaking\n- **Thing** `thing-factory`: renamed.\n';
    const withoutSteps = `thing-factory:\n  symbols: [Thing.make]\n  upgrade: { before: "a", after: "b" }\n  downgrade: { steps: ["back"] }\n`;
    const problems = found({ log: log({ version: '0.4.2', body }), migration: withoutSteps });

    expect(
      problems.some(
        (line) =>
          line.startsWith('0.4.2/migration.yaml:') &&
          line.includes('thing-factory') &&
          line.includes('upgrade.steps'),
      ),
    ).toBe(true);
    expect(
      found({
        log: log({ version: '0.4.2', released: '2026-11-01', body }),
        migration: withoutSteps,
      }),
    ).toEqual([]);
    expect(
      found({ log: log({ version: '0.4.2', body }), migration: `thing-factory:\n${BLOCK}` }),
    ).toEqual([]);
  });

  test('upgrade: steps alone, steps with before and after, and before and after alone all parse; before alone does not', () => {
    const body = '\n## Breaking\n- **Thing** `thing-factory`: renamed.\n';
    const block = (upgrade: string): string =>
      `thing-factory:\n  symbols: [Thing.make]\n  upgrade: ${upgrade}\n  downgrade: { steps: ["back"] }\n`;
    const released = log({ version: '0.4.2', released: '2026-11-01', body });

    for (const upgrade of [
      '{ steps: ["a"] }',
      '{ steps: ["a"], before: "b", after: "c" }',
      '{ before: "b", after: "c" }',
    ]) {
      expect(found({ log: released, migration: block(upgrade) })).toEqual([]);
    }

    expect(found({ log: released, migration: block('{ steps: ["a"], before: "b" }') })).not.toEqual(
      [],
    );
  });

  test('the opening paragraph of an in-progress folder does not name migration.yaml: the page links the guide itself', () => {
    const body = '\n## Added\n- **A** `a-item`: a.\n';
    const named = log({ version: '0.4.2', body }).replace(
      '---\n\n## Added',
      '---\nRead migration.yaml for the before and after.\n\n## Added',
    );

    expect(
      found({ log: named }).some(
        (line) => line.startsWith('0.4.2/log.md:') && line.includes('migration.yaml'),
      ),
    ).toBe(true);
    expect(
      found({
        log: log({
          version: '0.4.2',
          body: '\n## Added\n- **A** `a-item`: a, and `migration.yaml` holds the blocks.\n',
        }),
      }),
    ).toEqual([]);
    expect(
      found({
        log: log({
          version: '0.4.2',
          released: '2026-11-01',
          body: `Read migration.yaml.\n${body}`,
        }),
      }),
    ).toEqual([]);
  });

  test('VersionFolders.parse exposes the summary and the highlights', () => {
    const folder = VersionFolders.parse({
      name: '0.4.2',
      log: log({
        version: '0.4.2',
        body: ADDED,
        summary: 'What it is.',
        highlights: ['One', 'Two'],
      }),
    });

    expect(folder.summary).toBe('What it is.');
    expect(folder.highlights).toEqual(['One', 'Two']);
    expect(
      VersionFolders.parse({
        name: '0.4.2',
        log: log({ version: '0.4.2', released: '2026-11-01', body: ADDED }),
      }).highlights,
    ).toBeUndefined();
  });
});
