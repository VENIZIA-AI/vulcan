import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersionFolders } from '@/changelogs/version-folder';
import { ProjectConfig } from '@/common/project-config';
import { FolderStates, MigratePlan, MigrateReport } from '@/migrations';
import { FolderAtStatuses, FolderHistory, ReleaseCompute, ReleaseStore } from '@/releases';
import type { IFolderHistory } from '@/releases';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const PACKAGES = [
  { name: '@a/kernel', dir: 'kernel', aliases: [], retired: false },
  { name: '@a/web', dir: 'web', aliases: [], retired: false },
];

const block = (opts: { n: number; reorder?: boolean }): string =>
  opts.reorder === true
    ? `  downgrade: { steps: ["Down${opts.n}"] }\n  upgrade: { after: "Up${opts.n}()", before: "Thing.make()" }\n  symbols: [Thing.make]\n`
    : `  symbols: [Thing.make]\n  upgrade: { before: "Thing.make()", after: "Up${opts.n}()" }\n  downgrade: { steps: ["Down${opts.n}"] }\n`;

interface IItem {
  section: string;
  id: string;
  packages?: string;
  prose?: string;
  block?: string;
}

const folderOf = (opts: { version: string; released?: string; items: IItem[] }) => {
  const sections = ['Breaking', 'Deprecated', 'Added'];
  const body = sections
    .filter((section) => opts.items.some((item) => item.section === section))
    .map(
      (section) =>
        `## ${section}\n${opts.items
          .filter((item) => item.section === section)
          .map(
            (item) =>
              `- **${item.id}** \`${item.id}\`${item.packages === undefined ? '' : ` (\`${item.packages}\`)`}: ${item.prose ?? 'text'}.\n`,
          )
          .join('')}`,
    )
    .join('\n');
  const migration = opts.items
    .filter((item) => item.block !== undefined)
    .map((item) => `${item.id}:\n${item.block}`)
    .join('');

  return {
    log: `---\ntitle: ${opts.version}\nversion: ${opts.version}\npackages: ['@a/kernel', '@a/web']\n${opts.released === undefined ? '' : `released: ${opts.released}\n`}---\n\n${body}`,
    migration,
  };
};

const S13: IItem[] = [
  {
    section: 'Breaking',
    id: 'thing-factory',
    packages: '@a/kernel',
    prose: 'first',
    block: block({ n: 1 }),
  },
  { section: 'Added', id: 'a-note' },
];
const S14: IItem[] = [
  ...S13,
  { section: 'Deprecated', id: 'old-flag', packages: '@a/kernel', block: block({ n: 2 }) },
  { section: 'Breaking', id: 'web-thing', packages: '@a/web', block: block({ n: 3 }) },
];
const S15: IItem[] = [
  ...S14,
  { section: 'Breaking', id: 'temp-item', packages: '@a/kernel', block: block({ n: 4 }) },
  { section: 'Breaking', id: 'late-item', packages: '@a/kernel', block: block({ n: 5 }) },
];
const S16: IItem[] = [
  {
    section: 'Breaking',
    id: 'thing-factory',
    packages: '@a/kernel',
    prose: 'reworded',
    block: block({ n: 1, reorder: true }),
  },
  { section: 'Breaking', id: 'old-flag', packages: '@a/kernel', block: block({ n: 2 }) },
  { section: 'Breaking', id: 'web-thing', packages: '@a/web', block: block({ n: 3 }) },
  { section: 'Breaking', id: 'late-item', packages: '@a/kernel', block: block({ n: 6 }) },
  { section: 'Breaking', id: 'new-api', packages: '@a/kernel', block: block({ n: 7 }) },
  { section: 'Added', id: 'a-note' },
];

/** A project whose line 0.4.5 is in progress: its folder changes at each prerelease tag; HEAD is the last one. */
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-state-diff-'));
  const app = mkdtempSync(join(tmpdir(), 'atlas-state-diff-app-'));

  roots.push(root, app);
  mkdirSync(join(root, 'changes', '0.4.5'), { recursive: true });

  const git = (args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };
  const write = (opts: { items: IItem[] }): void => {
    const files = folderOf({ version: '0.4.5', items: opts.items });

    writeFileSync(join(root, 'changes', '0.4.5', 'log.md'), files.log);
    writeFileSync(join(root, 'changes', '0.4.5', 'migration.yaml'), files.migration);
  };
  const tagged = (opts: { items: IItem[]; tags: string[] }): void => {
    write({ items: opts.items });
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', `chore: ${opts.tags.join(' ')}`]);

    for (const tag of opts.tags) {
      git(['tag', '-a', tag, '-m', tag]);
    }
  };

  git(['init', '-q', '-b', 'develop']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);
  git(['tag', '-a', 'kernel-v0.4.4', '-m', 'k']);
  tagged({ items: S13, tags: ['web-v0.4.5-13'] });
  tagged({ items: S14, tags: ['kernel-v0.4.5-14'] });
  tagged({ items: S15, tags: ['kernel-v0.4.5-15'] });
  tagged({ items: S16, tags: ['kernel-v0.4.5-16', 'web-v0.4.5-16'] });
  tagged({ items: S16, tags: ['kernel-v0.4.5-17'] });

  const project = ProjectConfig.toAtlasProject({
    root,
    manifest: {
      schemaVersion: 1,
      packages: PACKAGES,
      knowledge: { changelogs: 'changes' },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    },
  });
  const releases = new ReleaseStore({
    table: ReleaseCompute.compute({ project }),
    folderHistory: new FolderHistory({ project }),
    codemodPackages: ['@a/kernel'],
  });

  return { app, releases, project };
};

const planOf = (opts: {
  made: { app: string; releases: ReleaseStore };
  package?: string;
  from: string;
  to: string;
}) =>
  MigratePlan.plans({
    releases: opts.made.releases,
    app: opts.made.app,
    package: opts.package ?? '@a/kernel',
    from: opts.from,
    to: opts.to,
  }).plans[0];

const stepsOf = (opts: {
  made: { app: string; releases: ReleaseStore };
  package?: string;
  from: string;
  to: string;
}) => planOf(opts).steps.map((step) => `${step.direction}:${step.id}`);

describe('migrate reads the folder state at each end (A2)', () => {
  const made = repo();

  test('C5: an item added in -15 and removed in -16 shows nothing for -14 to -16', () => {
    const steps = stepsOf({ made, from: '0.4.5-14', to: '0.4.5-16' });

    expect(steps.some((step) => step.endsWith('temp-item'))).toBe(false);
  });

  test('C6: -15 to -16 undoes the item -16 removed, as a downgrade step of its -15 block', () => {
    const plan = planOf({ made, from: '0.4.5-15', to: '0.4.5-16' });
    const temp = plan.steps.find((step) => step.id === 'temp-item');

    expect(plan.direction).toBe('upgrade');
    expect(temp?.direction).toBe('downgrade');
    expect(temp?.change).toEqual({ steps: ['Down4'] });
  });

  test('C8: a section or block change lists the item; a prose edit and a reordered key list nothing', () => {
    const steps = stepsOf({ made, from: '0.4.5-14', to: '0.4.5-16' });

    expect(steps).toContain('downgrade:old-flag');
    expect(steps).toContain('upgrade:old-flag');
    expect(steps.some((step) => step.endsWith('thing-factory'))).toBe(false);
  });

  test('every downgrade comes before every upgrade, in file order for what is applied', () => {
    const steps = stepsOf({ made, from: '0.4.5-14', to: '0.4.5-16' });

    expect(steps).toEqual([
      'downgrade:old-flag',
      'upgrade:old-flag',
      'upgrade:late-item',
      'upgrade:new-api',
    ]);
  });

  test('the other way: what -16 holds is undone newest first, then -14 is applied', () => {
    const steps = stepsOf({ made, from: '0.4.5-16', to: '0.4.5-14' });

    expect(steps).toEqual([
      'downgrade:new-api',
      'downgrade:late-item',
      'downgrade:old-flag',
      'upgrade:old-flag',
    ]);
  });

  test('a changed item is flagged and appears twice, once per direction', () => {
    const plan = planOf({ made, from: '0.4.5-14', to: '0.4.5-16' });
    const old = plan.steps.filter((step) => step.id === 'old-flag');

    expect(old.map((step) => step.changed)).toEqual([true, true]);
    expect(old[0].change).toEqual({ steps: ['Down2'] });
    expect(old[1].change).toEqual({ before: 'Thing.make()', after: 'Up2()' });
  });

  test('a package reads its own tag: web at -13 is not what kernel was at -14', () => {
    const plan = planOf({ made, package: '@a/web', from: '0.4.5-13', to: '0.4.5-16' });

    expect(plan.steps.map((step) => `${step.direction}:${step.id}`)).toEqual(['upgrade:web-thing']);
  });

  test('equal states are a real answer: entries counted, no step, no empty-window warning', () => {
    const plan = planOf({ made, from: '0.4.5-16', to: '0.4.5-17' });
    const text = MigrateReport.markdown({
      result: { app: made.app, plans: [plan], skipped: [], unserved: [] },
    });

    expect(plan.steps).toEqual([]);
    expect(plan.entries).toBeGreaterThan(0);
    expect(text).not.toContain('proves nothing');
  });

  test('a plan that undoes and applies says which each step is', () => {
    const plan = planOf({ made, from: '0.4.5-15', to: '0.4.5-16' });
    const text = MigrateReport.markdown({
      result: { app: made.app, plans: [plan], skipped: [], unserved: [] },
    });

    expect(text).toContain('Undo.');
    expect(text).toContain('Apply (the item changed between the two versions).');
  });
});

describe('FolderStates over a history that cannot read a tag (C11)', () => {
  const folder = (opts: { items: IItem[] }) =>
    VersionFolders.parse({ name: '0.4.5', ...folderOf({ version: '0.4.5', items: opts.items }) });
  const history = (opts: { unreadable: string[] }): IFolderHistory => ({
    folders: () => [folder({ items: S16 })],
    at: ({ version }) =>
      opts.unreadable.includes(version)
        ? { status: FolderAtStatuses.UNREADABLE, reason: `no blob at ${version}` }
        : {
            status: FolderAtStatuses.FOLDER,
            tag: `kernel-v${version}`,
            folder: folder({ items: S15 }),
          },
  });
  const versions = ['0.4.5-16', '0.4.5-15', '0.4.5-14', '0.4.4'];

  test('the state falls back to the nearest earlier tag of the line and names it', () => {
    const state = FolderStates.stateOf({
      history: history({ unreadable: ['0.4.5-16'] }),
      package: '@a/kernel',
      version: '0.4.5-16',
      versions,
    });

    expect(state.items.some((item) => item.id === 'temp-item')).toBe(true);
    expect(state.notes[0]).toContain('kernel-v0.4.5-15');
    expect(state.notes[0]).toContain('0.4.5-16');
  });

  test('nothing readable: only the earlier lines count, and the note says the line was not read', () => {
    const state = FolderStates.stateOf({
      history: history({ unreadable: versions }),
      package: '@a/kernel',
      version: '0.4.5-16',
      versions,
    });

    expect(state.items).toEqual([]);
    expect(state.notes[0]).toContain('could not be read at any tag');
  });
});

/** 0.4.6 and 0.4.7 are folded after their stables are tagged: no tag holds a folder; HEAD holds both. */
const foldedRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-state-folded-'));
  const app = mkdtempSync(join(tmpdir(), 'atlas-state-folded-app-'));

  roots.push(root, app);
  mkdirSync(join(root, 'changes'), { recursive: true });

  const git = (args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };
  const release = (tag: string): void => {
    git(['commit', '-q', '--allow-empty', '-m', `chore: ${tag}`]);
    git(['tag', '-a', tag, '-m', tag]);
  };

  git(['init', '-q', '-b', 'develop']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);
  release('kernel-v0.4.5');
  release('kernel-v0.4.6-3');
  writeFileSync(
    join(root, 'changes', '2026-11-02-six.md'),
    '---\ntitle: Six\npackages: [\'@a/kernel\']\n---\n\n<Badge type="danger" text="Breaking Change" />\n\nSix changed.\n',
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: six']);
  release('kernel-v0.4.6');
  writeFileSync(
    join(root, 'changes', '2026-11-04-dated-seven.md'),
    '---\ntitle: Dated seven\npackages: [\'@a/kernel\']\nmigration:\n  - id: dated-seven\n    symbols: [Thing.make]\n    upgrade: { steps: [up dated] }\n    downgrade: { steps: [down dated] }\n---\n\n<Badge type="danger" text="Breaking Change" />\n\nSeven changed.\n',
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: dated seven']);
  release('kernel-v0.4.7-1');
  release('kernel-v0.4.7');

  for (const [version, items] of [
    [
      '0.4.6',
      [{ section: 'Breaking', id: 'six-break', packages: '@a/kernel', block: block({ n: 61 }) }],
    ],
    [
      '0.4.7',
      [{ section: 'Breaking', id: 'seven-break', packages: '@a/kernel', block: block({ n: 71 }) }],
    ],
  ] as const) {
    mkdirSync(join(root, 'changes', version));

    const files = folderOf({ version, released: '2026-11-10', items: [...items] });

    writeFileSync(join(root, 'changes', version, 'log.md'), files.log);
    writeFileSync(join(root, 'changes', version, 'migration.yaml'), files.migration);
  }

  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: fold']);

  const project = ProjectConfig.toAtlasProject({
    root,
    manifest: {
      schemaVersion: 1,
      packages: PACKAGES,
      knowledge: { changelogs: 'changes' },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    },
  });

  return {
    app,
    releases: new ReleaseStore({
      table: ReleaseCompute.compute({ project }),
      folderHistory: new FolderHistory({ project }),
      codemodPackages: ['@a/kernel'],
    }),
  };
};

describe('folded lines (C9, C10)', () => {
  const made = foldedRepo();

  test('C9: stable to stable over two folded lines holds the items of both, oldest first; the other way, newest first', () => {
    expect(stepsOf({ made, from: '0.4.5', to: '0.4.7' })).toEqual([
      'upgrade:six-break',
      'upgrade:seven-break',
    ]);
    expect(stepsOf({ made, from: '0.4.7', to: '0.4.5' })).toEqual([
      'downgrade:seven-break',
      'downgrade:six-break',
    ]);
  });

  test('C10: pinned to a prerelease of a folded line, the plan splits at its stable and names the folder to read', () => {
    const plan = planOf({ made, from: '0.4.6-3', to: '0.4.7' });

    // The dated entry inside the line has no block: listed, never a clean answer; the folded line's items are not repeated.
    expect(plan.steps.map((step) => `${step.direction}:${step.id}`)).toEqual([
      'upgrade:seven-break',
    ]);
    expect(plan.unstructured.map((entry) => entry.id)).toEqual(['changelog:2026-11-02-six']);
    expect(plan.note).toContain('prerelease of 0.4.6');
    expect(plan.note).toContain('changelog:0.4.6');
  });

  test('a prerelease of a folded line as the target is split the same way', () => {
    const plan = planOf({ made, from: '0.4.5', to: '0.4.6-3' });

    expect(plan.steps).toEqual([]);
    expect(plan.note).toContain('folded');
  });
});

describe('plans that end in a folded prerelease, and states without a block', () => {
  const made = foldedRepo();

  test('a plan that ends in a folded prerelease puts its dated steps after the folder items; the rollback puts them first', () => {
    expect(stepsOf({ made, from: '0.4.5', to: '0.4.7-1' })).toEqual([
      'upgrade:six-break',
      'upgrade:dated-seven',
    ]);
    expect(stepsOf({ made, from: '0.4.7-1', to: '0.4.5' })).toEqual([
      'downgrade:dated-seven',
      'downgrade:six-break',
    ]);
  });

  test('the entries of a plan count the lines it touches, not the whole history', () => {
    expect(planOf({ made, from: '0.4.6', to: '0.4.7' }).entries).toBe(2);
  });
});

describe('a folder that came into a line mid-cycle', () => {
  const lineRepo = (opts: { stable: boolean }) => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-state-mid-'));
    const app = mkdtempSync(join(tmpdir(), 'atlas-state-mid-app-'));

    roots.push(root, app);
    mkdirSync(join(root, 'changes', '0.4.5'), { recursive: true });

    const git = (args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: root,
        stdio: 'ignore',
      });
    };
    const item = (id: string, n: number): IItem => ({
      section: 'Breaking',
      id,
      packages: '@a/kernel',
      block: block({ n }),
    });
    const tagged = (tag: string, items?: IItem[]): void => {
      if (items !== undefined) {
        const files = folderOf({ version: '0.4.5', items });

        writeFileSync(join(root, 'changes', '0.4.5', 'log.md'), files.log);
        writeFileSync(join(root, 'changes', '0.4.5', 'migration.yaml'), files.migration);
      }

      git(['add', '-A']);
      git(['commit', '-q', '--allow-empty', '-m', tag]);
      git(['tag', '-a', tag, '-m', tag]);
    };

    git(['init', '-q', '-b', 'develop']);
    git(['commit', '-q', '--allow-empty', '-m', 'init']);
    tagged('kernel-v0.4.5-1');
    tagged('kernel-v0.4.5-2', [item('aa', 1)]);
    tagged('kernel-v0.4.5-3', [item('aa', 1), item('bb', 2)]);

    if (opts.stable) {
      tagged('kernel-v0.4.5', [item('aa', 1), item('bb', 2), item('cc', 3)]);
    } else {
      writeFileSync(
        join(root, 'changes', '0.4.5', 'log.md'),
        folderOf({ version: '0.4.5', items: [item('aa', 1), item('bb', 2), item('cc', 3)] }).log,
      );
      writeFileSync(
        join(root, 'changes', '0.4.5', 'migration.yaml'),
        folderOf({ version: '0.4.5', items: [item('aa', 1), item('bb', 2), item('cc', 3)] })
          .migration,
      );
    }

    const project = ProjectConfig.toAtlasProject({
      root,
      manifest: {
        schemaVersion: 1,
        packages: PACKAGES,
        knowledge: { changelogs: 'changes' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });

    return {
      app,
      releases: new ReleaseStore({
        table: ReleaseCompute.compute({ project }),
        folderHistory: new FolderHistory({ project }),
        codemodPackages: ['@a/kernel'],
      }),
    };
  };

  test('a prerelease tagged before the folder existed counts the folder at the other end as new, and never reads the final one', () => {
    for (const stable of [true, false]) {
      const made = lineRepo({ stable });
      const plan = planOf({ made, from: '0.4.5-1', to: '0.4.5-3' });

      expect(plan.steps.map((step) => `${step.direction}:${step.id}`)).toEqual([
        'upgrade:aa',
        'upgrade:bb',
      ]);
      expect(plan.note).toContain('before the folder of 0.4.5 existed');
    }
  });
});

describe('the state of an item', () => {
  const folderWith = (opts: { packages: string[]; section?: string; id?: string }) =>
    VersionFolders.parse({
      name: '0.4.5',
      log: `---\ntitle: x\nversion: 0.4.5\npackages: [${opts.packages.map((name) => `'${name}'`).join(', ')}]\n---\n\n## ${opts.section ?? 'Added'}\n- **X** \`${opts.id ?? 'xx'}\`: text.\n`,
    });
  const historyOf = (opts: {
    at: IFolderHistory['at'];
    head: ReturnType<typeof folderWith>;
  }): IFolderHistory => ({
    folders: () => [opts.head],
    at: opts.at,
  });

  test('a package joining the folder does not make the items it inherits look changed', () => {
    const history = historyOf({
      head: folderWith({ packages: ['@a/kernel', '@a/web'] }),
      at: ({ version }) => ({
        status: FolderAtStatuses.FOLDER,
        tag: `kernel-v${version}`,
        folder: folderWith({
          packages: version === '0.4.5-2' ? ['@a/kernel'] : ['@a/kernel', '@a/web'],
        }),
      }),
    });
    const versions = ['0.4.5-3', '0.4.5-2'];
    const state = (version: string) =>
      FolderStates.stateOf({ history, package: '@a/kernel', version, versions }).items;

    expect(FolderStates.diff({ from: state('0.4.5-2'), to: state('0.4.5-3') })).toEqual([]);
  });

  test('an item with no block that changes section is listed once among the breaking changes without steps', () => {
    const history = historyOf({
      head: folderWith({ packages: ['@a/kernel'], section: 'Breaking' }),
      at: ({ version }) => ({
        status: FolderAtStatuses.FOLDER,
        tag: `kernel-v${version}`,
        folder: folderWith({
          packages: ['@a/kernel'],
          section: version === '0.4.5-2' ? 'Deprecated' : 'Breaking',
        }),
      }),
    });
    const versions = ['0.4.5-3', '0.4.5-2'];
    const state = (version: string) =>
      FolderStates.stateOf({ history, package: '@a/kernel', version, versions }).items;
    const moves = FolderStates.diff({ from: state('0.4.5-2'), to: state('0.4.5-3') });
    const releases = new ReleaseStore({
      table: {
        livePackages: ['kernel'],
        packageMap: [{ dir: 'kernel', name: '@a/kernel', aliases: [] }],
        releases: {
          kernel: [
            { version: '0.4.5-3', date: '2026-11-02', sha: 'b', order: 1 },
            { version: '0.4.5-2', date: '2026-11-01', sha: 'a', order: 0 },
          ],
        },
        changelogs: [],
      },
      folderHistory: history,
    });
    const plan = MigratePlan.plans({
      releases,
      app: mkdtempSync(join(tmpdir(), 'atlas-state-once-')),
      package: '@a/kernel',
      from: '0.4.5-2',
      to: '0.4.5-3',
    }).plans[0];

    expect(moves.map((move) => move.direction)).toEqual(['downgrade', 'upgrade']);
    expect(plan.unstructured.map((entry) => entry.id)).toEqual(['changelog:0.4.5#xx']);
  });

  test('a tag that cannot be read before one with no folder is said, not folded silently', () => {
    const history = historyOf({
      head: folderWith({ packages: ['@a/kernel'] }),
      at: ({ version }) =>
        version === '0.4.5-3'
          ? { status: FolderAtStatuses.UNREADABLE, reason: 'no blob' }
          : { status: FolderAtStatuses.ABSENT, tag: `kernel-v${version}` },
    });
    const state = FolderStates.stateOf({
      history,
      package: '@a/kernel',
      version: '0.4.5-3',
      versions: ['0.4.5-3', '0.4.5-2'],
    });

    expect(state.folded).toBe('0.4.5');
    expect(state.notes[0]).toContain('no blob');
  });
});

describe('FolderHistory in a project below the top of its repository', () => {
  test('reads the folder at a tag from the project root, not from the top of the repository', () => {
    const top = mkdtempSync(join(tmpdir(), 'atlas-state-sub-'));

    roots.push(top);
    mkdirSync(join(top, 'sub', 'changes', '0.4.5'), { recursive: true });

    const files = folderOf({ version: '0.4.5', items: S13 });

    writeFileSync(join(top, 'sub', 'changes', '0.4.5', 'log.md'), files.log);
    writeFileSync(join(top, 'sub', 'changes', '0.4.5', 'migration.yaml'), files.migration);

    for (const args of [
      ['init', '-q', '-b', 'develop'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'state'],
      ['tag', '-a', 'kernel-v0.4.5-1', '-m', 'k'],
    ]) {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: top,
        stdio: 'ignore',
      });
    }

    const project = ProjectConfig.toAtlasProject({
      root: join(top, 'sub'),
      manifest: {
        schemaVersion: 1,
        packages: PACKAGES,
        knowledge: { changelogs: 'changes' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });
    const found = new FolderHistory({ project }).at({
      package: '@a/kernel',
      version: '0.4.5-1',
      line: '0.4.5',
    });

    expect(found.status).toBe(FolderAtStatuses.FOLDER);
  });
});

describe('migrate points at the upgrade guide', () => {
  const made = repo();
  const withSite = (opts: { siteUrl?: string }) => ({
    ...made,
    releases: new ReleaseStore({
      table: ReleaseCompute.compute({ project: made.project }),
      folderHistory: new FolderHistory({ project: made.project }),
      codemodPackages: ['@a/kernel'],
      siteUrl: opts.siteUrl,
    }),
  });

  test('with knowledge.siteUrl each folder step names its guide, and the report prints it', () => {
    const site = withSite({ siteUrl: 'https://wiki.example.test' });
    const plan = planOf({ made: site, from: '0.4.5-14', to: '0.4.5-16' });
    const step = plan.steps.find((entry) => entry.id === 'new-api');

    expect(step?.guide).toBe('https://wiki.example.test/changelogs/0.4.5/upgrade#new-api');
    expect(
      plan.steps.every(
        (entry) => entry.guide === `https://wiki.example.test/changelogs/0.4.5/upgrade#${entry.id}`,
      ),
    ).toBe(true);
    expect(
      MigrateReport.markdown({
        result: { app: site.app, plans: [plan], skipped: [], unserved: [] },
      }),
    ).toContain('Guide: https://wiki.example.test/changelogs/0.4.5/upgrade#new-api');
  });

  test('without it a step has no guide and the report prints no Guide line', () => {
    const plain = withSite({});
    const plan = planOf({ made: plain, from: '0.4.5-14', to: '0.4.5-16' });

    expect(plan.steps.some((entry) => entry.guide !== undefined)).toBe(false);
    expect(
      MigrateReport.markdown({
        result: { app: plain.app, plans: [plan], skipped: [], unserved: [] },
      }),
    ).not.toContain('Guide:');
  });

  test('an upgrade with steps and a before and after prints both: the code, then the numbered steps', () => {
    const lines = MigrateReport.changeLines({
      change: { before: 'a()', after: 'b()', steps: ['Rename a to b', 'Run bun check'] },
    });

    expect(lines).toContain('Before:');
    expect(lines).toContain('After:');
    expect(lines).toContain('a()');
    expect(lines).toContain('b()');
    expect(lines.indexOf('1. Rename a to b')).toBeGreaterThan(lines.indexOf('b()'));
    expect(lines).toContain('2. Run bun check');
    expect(MigrateReport.changeLines({ change: { steps: ['Only steps'] } })).toEqual([
      '1. Only steps',
    ]);
  });
});

describe('a plan to a line the folders do not reach says so', () => {
  const lines = (opts: { withNewFolder: boolean }) => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-plan-line-'));
    const app = mkdtempSync(join(tmpdir(), 'atlas-plan-line-app-'));

    roots.push(root, app);

    const git = (args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: root,
        stdio: 'ignore',
      });
    };
    const folder = (version: string): void => {
      const files = folderOf({
        version,
        items: [{ section: 'Added', id: `item-${version.replaceAll('.', '-')}` }],
      });

      mkdirSync(join(root, 'changes', version), { recursive: true });
      writeFileSync(join(root, 'changes', version, 'log.md'), files.log);
      writeFileSync(join(root, 'changes', version, 'migration.yaml'), files.migration);
    };

    git(['init', '-q', '-b', 'develop']);
    folder('0.4.5');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'a']);
    git(['tag', '-a', 'kernel-v0.4.5', '-m', 'k']);

    if (opts.withNewFolder) {
      folder('0.5.0');
    }

    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', 'b']);
    git(['tag', '-a', 'kernel-v0.5.0-0', '-m', 'k']);

    const project = ProjectConfig.toAtlasProject({
      root,
      manifest: {
        schemaVersion: 1,
        packages: PACKAGES,
        knowledge: { changelogs: 'changes' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });

    return {
      app,
      releases: new ReleaseStore({
        table: ReleaseCompute.compute({ project }),
        folderHistory: new FolderHistory({ project }),
        codemodPackages: ['@a/kernel'],
      }),
    };
  };

  test('folders that end at 0.4.5 and a plan to 0.5.0-0: the note names the end and the way out', () => {
    const plan = planOf({ made: lines({ withNewFolder: false }), from: '0.4.5', to: '0.5.0-0' });

    expect(plan.note).toContain('end at 0.4.5 and hold none for 0.5.0');
    expect(plan.note).toContain('vulcan atlas pull');
  });

  test('a folder for 0.5.0 in the history: no note', () => {
    const plan = planOf({ made: lines({ withNewFolder: true }), from: '0.4.5', to: '0.5.0-0' });

    expect(plan.note ?? '').not.toContain('hold none');
  });
});
