import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { ChangelogLayouts, ReleaseCompute, ReleaseStore } from '@/releases';

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

const log = (opts: { version: string; released?: string; body: string }): string =>
  `---\ntitle: ${opts.version}\nversion: ${opts.version}\npackages: ['@a/kernel', '@a/web']\n${opts.released === undefined ? '' : `released: ${opts.released}\n`}---\n${opts.body}`;

const dated = (opts: { title: string }): string =>
  `---\ntitle: ${opts.title}\npackages: ['@a/kernel']\n---\n\nA change.\n`;

/**
 * kernel 0.4.4 stable, a dated file `a` (the 0.4.5 cycle), kernel 0.4.5-1, web 0.4.5 and kernel 0.4.5 released
 * at different commits, a dated file `b` (the 0.4.6 cycle), then the folders for 0.4.5 and 0.4.6.
 */
const repo = (opts: { openBody?: string; folderForOpen?: boolean } = {}) => {
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
  release({ tag: 'web-v0.4.5' });
  release({ tag: 'kernel-v0.4.5' });
  write('changes/2026-11-02-b.md', dated({ title: 'B' }));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: b']);

  mkdirSync(join(root, 'changes', '0.4.5'));
  write(
    'changes/0.4.5/log.md',
    log({
      version: '0.4.5',
      released: '2026-11-03',
      body: '\nThe 0.4.5 line.\n\n## Breaking\n- **Factory only** `thing-factory` (`@a/kernel`): call it.\n\n## Added\n- **A flag** `a-flag` (`@a/web`): new.\n',
    }),
  );
  write(
    'changes/0.4.5/migration.yaml',
    'thing-factory:\n  symbols: [Thing.make]\n  upgrade: { before: "Thing.make()", after: "ThingFactory.build()" }\n  downgrade: { steps: ["Use Thing.make() again"] }\n',
  );
  mkdirSync(join(root, 'changes', '0.4.6'));
  write(
    'changes/0.4.6/log.md',
    log({ version: '0.4.6', body: opts.openBody ?? '\n## Fixed\n- **A fix** `a-fix`: fixed.\n' }),
  );

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

  test('an item sits at the earliest stable release of the packages it names; the open line sits past every release', () => {
    const { table } = repo();
    const order = (id: string) => table.changelogs.find((entry) => entry.id === id)?.order;
    const kernel = table.releases.kernel.find((record) => record.version === '0.4.5');
    const web = table.releases.web.find((record) => record.version === '0.4.5');
    const newest = Math.max(
      ...Object.values(table.releases).flatMap((rs) => rs.map((r) => r.order)),
    );

    expect(order('changelog:0.4.5#thing-factory')).toBe(kernel?.order);
    expect(order('changelog:0.4.5#a-flag')).toBe(web?.order);
    expect(web?.order).toBeLessThan(kernel?.order ?? 0);
    expect(order('changelog:0.4.6#a-fix')).toBeGreaterThan(newest);
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
