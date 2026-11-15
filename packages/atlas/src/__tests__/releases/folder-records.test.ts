import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { VersionFolders } from '@/changelogs/version-folder';
import { ChangelogLayouts, ReleaseCompute, ReleaseStore } from '@/releases';
import { FolderRecords } from '@/releases/folder-records';

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

const projectOf = (opts: { root: string }) =>
  ProjectConfig.toAtlasProject({
    root: opts.root,
    manifest: {
      schemaVersion: 1,
      packages: PACKAGES,
      knowledge: { changelogs: 'changes' },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    },
  });

const log = (opts: { version: string; released?: string; body: string }): string =>
  `---\ntitle: ${opts.version}\nversion: ${opts.version}\npackages: ['@a/kernel', '@a/web']\n${opts.released === undefined ? '' : `released: ${opts.released}\n`}---\n${opts.body}`;

const dated = (opts: { title: string }): string =>
  `---\ntitle: ${opts.title}\npackages: ['@a/kernel']\n---\n\nA change.\n`;

/**
 * kernel 0.4.4 stable, a dated file `a` (the 0.4.5 cycle), kernel 0.4.5-1, web 0.4.5 and kernel 0.4.5 released
 * at different commits, a dated file `b` (the 0.4.6 cycle), then the folders for 0.4.5 and 0.4.6.
 */
const repo = (opts: { openBody?: string; inProgress?: boolean } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-folder-records-'));

  roots.push(root);
  mkdirSync(join(root, 'changes'));

  const git = (args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };
  const write = (path: string, text: string): void => writeFileSync(join(root, path), text);
  const release = (opts2: { tag: string }): void => {
    git(['commit', '-q', '--allow-empty', '-m', `chore: release ${opts2.tag}`]);
    git(['tag', '-a', opts2.tag, '-m', opts2.tag]);
  };

  git(['init', '-q', '-b', 'develop']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);
  release({ tag: 'kernel-v0.4.4' });
  write('changes/2026-11-01-a.md', dated({ title: 'A' }));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: a']);
  release({ tag: 'kernel-v0.4.5-1' });

  if (opts.inProgress !== true) {
    release({ tag: 'web-v0.4.5' });
    release({ tag: 'kernel-v0.4.5' });
  }

  write('changes/2026-11-02-b.md', dated({ title: 'B' }));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: b']);

  mkdirSync(join(root, 'changes', '0.4.5'));
  write(
    'changes/0.4.5/log.md',
    log({
      version: '0.4.5',
      released: opts.inProgress === true ? undefined : '2026-11-03',
      body: '\nThe 0.4.5 line.\n\n## Breaking\n- **Factory only** `thing-factory` (`@a/kernel`): call it.\n\n## Added\n- **A flag** `a-flag` (`@a/web`): new.\n',
    }),
  );
  write(
    'changes/0.4.5/migration.yaml',
    'thing-factory:\n  symbols: [Thing.make]\n  upgrade: { before: "Thing.make()", after: "ThingFactory.build()" }\n  downgrade: { steps: ["Use Thing.make() again"] }\n',
  );

  if (opts.inProgress !== true) {
    mkdirSync(join(root, 'changes', '0.4.6'));
    write(
      'changes/0.4.6/log.md',
      log({
        version: '0.4.6',
        body: opts.openBody ?? '\n## Fixed\n- **A fix** `a-fix`: fixed.\n',
      }),
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

  return { root, table: ReleaseCompute.compute({ project }) };
};

describe('the release table reads version folders (A6)', () => {
  test('a released folder gives one record per item: the id, the section, the block, the date of released:', () => {
    const { table } = repo();
    const factory = table.changelogs.find((entry) => entry.id === 'changelog:0.4.5#thing-factory');

    expect(factory).toMatchObject({
      layout: ChangelogLayouts.FOLDER,
      version: '0.4.5',
      section: 'Breaking',
      kind: 'Breaking Change',
      breaking: true,
      date: '2026-11-03',
      file: '0.4.5/log.md',
      packages: ['kernel'],
    });
    expect(factory?.migration?.[0]).toMatchObject({
      id: 'thing-factory',
      symbols: ['Thing.make'],
    });
    expect(table.versionFolders).toEqual(['0.4.5', '0.4.6']);
  });

  test('an item sits just after the prior stable of the packages it names; the open line after those too', () => {
    const { table } = repo();
    const order = (id: string) => table.changelogs.find((entry) => entry.id === id)?.order;
    const kernel = (version: string) =>
      table.releases.kernel.find((record) => record.version === version)?.order ?? -9;
    const web = (version: string) =>
      table.releases.web.find((record) => record.version === version)?.order ?? -9;

    expect(order('changelog:0.4.5#thing-factory')).toBe(kernel('0.4.4') + 1);
    expect(order('changelog:0.4.5#a-flag')).toBe(0);
    expect(order('changelog:0.4.6#a-fix')).toBe(Math.max(kernel('0.4.5'), web('0.4.5')) + 1);
  });

  test('on the line in progress, a window to a prerelease of the line holds the folder items, and the dated file they replace is left out', () => {
    const { table } = repo({ inProgress: true });
    const store = new ReleaseStore({ table });
    const from = store.releaseOrderOf({ package: '@a/kernel', version: '0.4.4' }) ?? -1;
    const to = store.releaseOrderOf({ package: '@a/kernel', version: '0.4.5-1' }) ?? -1;
    const ids = store
      .entriesBetweenOrders({
        package: '@a/kernel',
        fromOrder: from,
        toOrder: to,
        fromDate: '',
        toDate: '',
      })
      .map((entry) => entry.id);

    expect(ids).toEqual(['changelog:0.4.5#thing-factory']);
  });

  test('a window that does not reach the folder items keeps the dated file: nothing is lost', () => {
    const { table } = repo();
    const store = new ReleaseStore({ table });
    const early = store.entriesBetween({ fromDate: '2026-10-31', toDate: '2026-11-02' });
    const late = store.entriesBetween({ fromDate: '2026-10-31', toDate: '2026-11-03' });

    expect(early.map((entry) => entry.id)).toContain('changelog:2026-11-01-a');
    expect(late.map((entry) => entry.id)).not.toContain('changelog:2026-11-01-a');
    expect(late.map((entry) => entry.id)).toContain('changelog:0.4.5#thing-factory');
  });

  test('a dated file a folder covers is marked, and a stable-to-stable window lists each change once', () => {
    const { table } = repo();
    const store = new ReleaseStore({ table });
    const folded = (file: string) => table.changelogs.find((entry) => entry.file === file);

    expect(folded('2026-11-01-a.md')?.foldedInto).toBe('0.4.5');
    expect(folded('2026-11-02-b.md')?.foldedInto).toBe('0.4.6');

    const from = store.releaseOrderOf({ package: '@a/kernel', version: '0.4.4' }) ?? -1;
    const to = store.releaseOrderOf({ package: '@a/kernel', version: '0.4.5' }) ?? -1;
    const window = { package: '@a/kernel', fromOrder: from, toOrder: to, fromDate: '', toDate: '' };
    const ids = store.entriesBetweenOrders(window).map((entry) => entry.id);

    expect(ids).toEqual(['changelog:0.4.5#thing-factory']);
    expect(
      store.entriesBetweenOrders({ ...window, includeFolded: true }).map((e) => e.id),
    ).toContain('changelog:2026-11-01-a');
  });

  test('a folder whose log has no item is still a folder the table read', () => {
    const { table } = repo({
      openBody: '\nNo change for users of the packages in this release.\n',
    });

    expect(table.versionFolders).toContain('0.4.6');
    expect(table.changelogs.some((entry) => entry.version === '0.4.6')).toBe(false);
  });

  test('a project with no folder keeps its dated records and marks none', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-folder-records-none-'));

    roots.push(root);
    mkdirSync(join(root, 'changes'));
    writeFileSync(join(root, 'changes', '2026-11-01-a.md'), dated({ title: 'A' }));

    const table = ReleaseCompute.compute({
      project: ProjectConfig.toAtlasProject({
        root,
        manifest: {
          schemaVersion: 1,
          packages: PACKAGES,
          knowledge: { changelogs: 'changes' },
          release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
        },
      }),
    });

    expect(table.versionFolders).toEqual([]);
    expect(table.changelogs.every((entry) => entry.foldedInto === undefined)).toBe(true);
  });
});

describe('the release table: edges of the folders', () => {
  test('a line in progress with no tag and no history is dated, never blank', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-folder-records-open-'));

    roots.push(root);
    mkdirSync(join(root, 'changes', '0.4.5'), { recursive: true });
    writeFileSync(
      join(root, 'changes', '0.4.5', 'log.md'),
      log({ version: '0.4.5', body: '\n## Added\n- **A** `a-item`: a.\n' }),
    );

    const table = ReleaseCompute.compute({ project: projectOf({ root }) });

    expect(table.changelogs[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a dangling link or a directory where a folder file belongs does not stop the table', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-folder-records-odd-'));

    roots.push(root);
    mkdirSync(join(root, 'changes', '0.4.6', 'log.md'), { recursive: true });
    symlinkSync(join(root, 'nowhere'), join(root, 'changes', '0.4.5'));

    const table = ReleaseCompute.compute({ project: projectOf({ root }) });

    expect(table.versionFolders).toEqual([]);
  });

  test('a folder file that links out of the checkout is not read', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-folder-records-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'atlas-folder-records-outside-'));

    roots.push(root, outside);
    writeFileSync(
      join(outside, 'log.md'),
      log({ version: '0.4.5', body: '\n## Added\n- **Secret** `secret-id`: x.\n' }),
    );
    mkdirSync(join(root, 'changes', '0.4.5'), { recursive: true });
    symlinkSync(join(outside, 'log.md'), join(root, 'changes', '0.4.5', 'log.md'));

    const table = ReleaseCompute.compute({ project: projectOf({ root }) });

    expect(table.versionFolders).toEqual([]);
    expect(table.changelogs).toEqual([]);
  });

  test('a stable with no folder between two folders does not widen the later line backwards', () => {
    const release = (version: string, order: number) => ({ version, date: 'd', sha: 's', order });
    const folder = (version: string) =>
      VersionFolders.parse({
        name: version,
        log: log({ version, released: '2026-11-01', body: '\n## Added\n- **A** `a-item`: a.\n' }),
      });
    const lines = FolderRecords.linesOf({
      folders: [folder('0.4.5'), folder('0.4.8')],
      releases: {
        kernel: [
          release('0.4.8', 9),
          release('0.4.7', 7),
          release('0.4.6', 5),
          release('0.4.5', 3),
        ],
      },
      openOrder: 10,
    });

    expect(lines).toEqual([
      { name: '0.4.5', from: -1, to: 3 },
      { name: '0.4.8', from: 7, to: 9 },
    ]);
  });
});
