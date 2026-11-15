import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersionFolders } from '@/changelogs/version-folder';
import { ProjectConfig } from '@/common/project-config';
import { FolderStates, MigratePlan, MigrateReport } from '@/migrations';
import { FolderAtKinds, FolderHistory, ReleaseCompute, ReleaseStore } from '@/releases';
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

  return { app, releases };
};

const planOf = (opts: {
  made: ReturnType<typeof repo>;
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
  made: ReturnType<typeof repo>;
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
        ? { kind: FolderAtKinds.UNREADABLE, reason: `no blob at ${version}` }
        : { kind: FolderAtKinds.FOLDER, tag: `kernel-v${version}`, folder: folder({ items: S15 }) },
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
    expect(plan.note).toContain('changelogs/0.4.6/log.md');
  });

  test('a prerelease of a folded line as the target is split the same way', () => {
    const plan = planOf({ made, from: '0.4.5', to: '0.4.6-3' });

    expect(plan.steps).toEqual([]);
    expect(plan.note).toContain('folded');
  });
});
