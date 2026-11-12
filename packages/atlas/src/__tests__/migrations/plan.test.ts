import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MigratePlan } from '@/migrations';
import type { TMigrationItem } from '@/migrations';
import { ReleaseStore } from '@/releases';
import type { IChangelogRecord, IReleaseTable } from '@/releases';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const item = (opts: {
  id: string;
  symbols: string[];
  data?: string;
  codemod?: string;
}): TMigrationItem => ({
  id: opts.id,
  symbols: opts.symbols,
  upgrade: { steps: [`up ${opts.id}`] },
  downgrade: { steps: [`down ${opts.id}`] },
  data: opts.data,
  codemod: opts.codemod,
});

const entry = (opts: {
  slug: string;
  date: string;
  order: number;
  kind?: string | null;
  packages?: string[];
  migration?: TMigrationItem[];
}): IChangelogRecord => ({
  id: `changelog:${opts.date}-${opts.slug}`,
  file: `${opts.date}-${opts.slug}.md`,
  date: opts.date,
  title: opts.slug,
  packages: opts.packages ?? ['@venizia/kernel'],
  kind: opts.kind ?? null,
  order: opts.order,
  migration: opts.migration,
});

const TABLE: IReleaseTable = {
  livePackages: ['kernel', 'web'],
  packageMap: [
    { dir: 'kernel', name: '@venizia/kernel', aliases: [] },
    { dir: 'web', name: '@venizia/web', aliases: [] },
  ],
  releases: {
    kernel: [
      { version: '1.3.0-0', date: '2026-04-01', sha: 'e', order: 7 },
      { version: '1.2.1', date: '2026-03-10', sha: 'd', order: 6 },
      { version: '1.2.0', date: '2026-03-10', sha: 'c', order: 4 },
      { version: '1.1.0', date: '2026-02-10', sha: 'b', order: 2 },
      { version: '1.0.0', date: '2026-01-10', sha: 'a', order: 0 },
    ],
    web: [{ version: '2.0.0', date: '2026-02-20', sha: 'f', order: 3 }],
  },
  changelogs: [
    entry({
      slug: 'rename',
      date: '2026-02-01',
      order: 1,
      kind: 'Breaking Change',
      migration: [item({ id: 'rename-thing', symbols: ['Thing.make'] })],
    }),
    entry({
      slug: 'two-items',
      date: '2026-03-01',
      order: 3,
      kind: 'Breaking Change',
      migration: [
        item({ id: 'drop-a', symbols: ['Gone'], data: 'Stored ids change.' }),
        item({ id: 'move-b', symbols: ['@venizia/kernel/old'], codemod: 'connector-imports' }),
      ],
    }),
    entry({ slug: 'old-breaking', date: '2026-03-05', order: 3, kind: 'Breaking' }),
    entry({ slug: 'a-feature', date: '2026-03-06', order: 3, kind: 'New Feature' }),
    entry({
      slug: 'same-day',
      date: '2026-03-10',
      order: 5,
      kind: 'Breaking Change',
      migration: [item({ id: 'between-two', symbols: ['Between'] })],
    }),
    entry({
      slug: 'web-only',
      date: '2026-03-02',
      order: 3,
      kind: 'Breaking Change',
      packages: ['@venizia/web'],
      migration: [item({ id: 'web-thing', symbols: ['Thing.make'] })],
    }),
  ],
};

const releases = new ReleaseStore({ table: TABLE });

const appWith = (opts: {
  dependencies?: Record<string, string>;
  files?: Record<string, string>;
}) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-plan-'));

  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: opts.dependencies ?? {} }),
  );

  for (const [path, text] of Object.entries(opts.files ?? {})) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
};

const USES = {
  'src/a.ts': "import { Thing } from '@venizia/kernel';\n\nThing.make();\n",
};

const treeHash = (opts: { root: string }): string => {
  const hash = createHash('sha256');
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);

      if (
        readdirSync(directory, { withFileTypes: true })
          .find((e) => e.name === name)
          ?.isDirectory()
      ) {
        walk(path);
      } else {
        hash.update(`${path}\n${readFileSync(path, 'utf8')}`);
      }
    }
  };

  walk(opts.root);

  return hash.digest('hex');
};

const plan = (opts: { app: string; from?: string; to: string; package?: string }) =>
  MigratePlan.plans({
    releases,
    app: opts.app,
    package: opts.package ?? '@venizia/kernel',
    from: opts.from,
    to: opts.to,
  });

describe('MigratePlan.plans', () => {
  test('C7: an upgrade lists the window oldest first, each item with its upgrade steps', () => {
    const app = appWith({ files: USES });
    const [result] = plan({ app, from: '1.0.0', to: '1.2.0' }).plans;

    expect(result.direction).toBe('upgrade');
    expect(result.steps.map((step) => step.id)).toEqual(['rename-thing', 'drop-a', 'move-b']);
    expect(result.steps.map((step) => step.change)).toEqual([
      { steps: ['up rename-thing'] },
      { steps: ['up drop-a'] },
      { steps: ['up move-b'] },
    ]);
    expect(result.steps[0].entry).toBe('changelog:2026-02-01-rename');
  });

  test('C8: a downgrade lists the same items newest first, each with its downgrade steps', () => {
    const app = appWith({ files: USES });
    const [result] = plan({ app, from: '1.2.0', to: '1.0.0' }).plans;

    expect(result.direction).toBe('downgrade');
    expect(result.steps.map((step) => step.id)).toEqual(['move-b', 'drop-a', 'rename-thing']);
    expect(result.steps.map((step) => step.change)).toEqual([
      { steps: ['down move-b'] },
      { steps: ['down drop-a'] },
      { steps: ['down rename-thing'] },
    ]);
  });

  test('C9.1: every entry between the releases appears once, none outside, two releases of one day included', () => {
    const app = appWith({});

    expect(plan({ app, from: '1.1.0', to: '1.2.0' }).plans[0].steps.map((step) => step.id)).toEqual(
      ['drop-a', 'move-b'],
    );
    expect(plan({ app, from: '1.2.0', to: '1.2.1' }).plans[0].steps.map((step) => step.id)).toEqual(
      ['between-two'],
    );
    expect(plan({ app, from: '1.0.0', to: '1.2.1' }).plans[0].steps.map((step) => step.id)).toEqual(
      ['rename-thing', 'drop-a', 'move-b', 'between-two'],
    );
  });

  test('C9.2: an entry placed at a release (a backfill) belongs to the window that ends there', () => {
    const app = appWith({});

    // `two-items` has order 3, `1.1.0` has order 2: it is after 1.1.0. An entry at order 2 is inside (1.0.0, 1.1.0].
    const at = new ReleaseStore({
      table: {
        ...TABLE,
        changelogs: [
          entry({
            slug: 'backfill',
            date: '2026-01-01',
            order: 2,
            migration: [item({ id: 'backfilled', symbols: ['X'] })],
          }),
        ],
      },
    });
    const result = MigratePlan.plans({
      releases: at,
      app,
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '1.1.0',
    });

    expect(result.plans[0].steps.map((step) => step.id)).toEqual(['backfilled']);
  });

  test('C10/C11: an item with touches lists them; one the app does not use has none and keeps its data', () => {
    const app = appWith({ files: USES });
    const [result] = plan({ app, from: '1.0.0', to: '1.2.0' }).plans;
    const [renamed, dropped] = result.steps;

    expect(renamed.touches).toEqual([{ file: 'src/a.ts', line: 3, symbol: 'Thing.make' }]);
    expect(dropped.touches).toEqual([]);
    expect(dropped.data).toBe('Stored ids change.');
  });

  test('a step carries the codemod name the entry links', () => {
    const app = appWith({});
    const [result] = plan({ app, from: '1.1.0', to: '1.2.0' }).plans;

    expect(result.steps.find((step) => step.id === 'move-b')?.codemod).toBe('connector-imports');
  });

  test('a breaking entry with no migration block is listed apart; other entries are not', () => {
    const app = appWith({});
    const [result] = plan({ app, from: '1.1.0', to: '1.2.0' }).plans;

    expect(result.unstructured.map((entryOf) => entryOf.id)).toEqual([
      'changelog:2026-03-05-old-breaking',
    ]);
  });

  test('C20: a breaking entry whose first badge is another one is listed as unstructured, as is an old table with only kind', () => {
    const second = new ReleaseStore({
      table: {
        ...TABLE,
        changelogs: [
          {
            ...entry({ slug: 'badge-second', date: '2026-02-05', order: 3, kind: 'New Feature' }),
            breaking: true,
          },
          entry({ slug: 'plain', date: '2026-02-06', order: 3, kind: 'New Feature' }),
        ],
      },
    });
    const [result] = MigratePlan.plans({
      releases: second,
      app: appWith({}),
      package: '@venizia/kernel',
      from: '1.1.0',
      to: '1.2.0',
    }).plans;

    expect(result.unstructured.map((entryOf) => entryOf.id)).toEqual([
      'changelog:2026-02-05-badge-second',
    ]);
  });

  test('the plan counts every entry of the window, structured or not, and an empty window counts 0', () => {
    const app = appWith({});

    expect(plan({ app, from: '1.1.0', to: '1.2.0' }).plans[0].entries).toBe(3);
    expect(plan({ app, from: '1.2.1', to: '1.3.0-0' }).plans[0].entries).toBe(0);
    expect(plan({ app, from: '1.1.0', to: '1.1.0' }).plans[0].entries).toBe(0);
  });

  test('C12.1: `from` is the version the app installs', () => {
    const app = appWith({ dependencies: { '@venizia/kernel': '1.1.0' } });
    const [result] = plan({ app, to: '1.2.0' }).plans;

    expect(result.from).toBe('1.1.0');
    expect(result.steps.map((step) => step.id)).toEqual(['drop-a', 'move-b']);
  });

  test('C12.2: a package the app does not install is an error naming the app and the package', () => {
    const app = appWith({});

    expect(() => plan({ app, to: '1.2.0' })).toThrow(
      /@venizia\/kernel.*not installed|not installed.*@venizia\/kernel/,
    );
    expect(() => plan({ app, to: '1.2.0' })).toThrow(app);
  });

  test('C13: latest is the newest stable of the table, next the newest release, and the plan says where it came from', () => {
    const app = appWith({});
    const latest = plan({ app, from: '1.0.0', to: 'latest' }).plans[0];
    const next = plan({ app, from: '1.0.0', to: 'next' }).plans[0];
    const named = plan({ app, from: '1.0.0', to: '1.2.0' }).plans[0];

    expect(latest.to).toBe('1.2.1');
    expect(next.to).toBe('1.3.0-0');
    expect(latest.target).toBe('release table');
    expect(next.target).toBe('release table');
    expect(named.target).toBe('version');
  });

  test('equal versions give an empty plan with direction none', () => {
    const [result] = plan({ app: appWith({}), from: '1.1.0', to: '1.1.0' }).plans;

    expect(result.direction).toBe('none');
    expect(result.steps).toEqual([]);
  });

  test('an unknown version is an error that lists the known ones', () => {
    expect(() => plan({ app: appWith({}), from: '9.9.9', to: '1.2.0' })).toThrow(
      /unknown version '9.9.9'/,
    );
    expect(() => plan({ app: appWith({}), from: '1.0.0', to: '9.9.9' })).toThrow(/known versions/);
  });

  test('with no package, one plan per installed package the sources know; a version needs a package', () => {
    const app = appWith({ dependencies: { '@venizia/kernel': '1.0.0', '@venizia/web': '2.0.0' } });
    const result = MigratePlan.plans({ releases, app, to: 'latest' });

    expect(result.plans.map((entryOf) => entryOf.package)).toEqual([
      '@venizia/kernel',
      '@venizia/web',
    ]);
    expect(() => MigratePlan.plans({ releases, app, to: '1.2.0' })).toThrow(/pass package/);
    expect(() => MigratePlan.plans({ releases, app, from: '1.0.0', to: 'latest' })).toThrow(
      /pass package/,
    );
  });

  test('an entry naming several packages appears in the plan of each', () => {
    const both = new ReleaseStore({
      table: {
        ...TABLE,
        changelogs: [
          entry({
            slug: 'shared',
            date: '2026-02-15',
            order: 3,
            packages: ['@venizia/kernel', '@venizia/web'],
            migration: [item({ id: 'shared-item', symbols: ['S'] })],
          }),
        ],
      },
    });
    const app = appWith({ dependencies: { '@venizia/kernel': '1.1.0', '@venizia/web': '1.0.0' } });

    expect(
      MigratePlan.plans({
        releases: both,
        app,
        package: '@venizia/kernel',
        from: '1.1.0',
        to: '1.2.0',
      }).plans[0].steps.map((step) => step.id),
    ).toEqual(['shared-item']);
  });

  test('an entry with no commit order (no git history) falls back to its date', () => {
    const dated = new ReleaseStore({
      table: {
        ...TABLE,
        changelogs: TABLE.changelogs.map(({ order: _order, ...rest }) => rest),
      },
    });
    const result = MigratePlan.plans({
      releases: dated,
      app: appWith({}),
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '1.1.0',
    });

    expect(result.plans[0].steps.map((step) => step.id)).toEqual(['rename-thing']);
  });

  test('a served package whose installed version is not in the table is skipped with the reason; the others are planned', () => {
    const app = appWith({
      dependencies: { '@venizia/kernel': '1.1.0+local', '@venizia/web': '2.0.0' },
    });
    const result = MigratePlan.plans({ releases, app, to: 'latest' });

    expect(result.plans.map((entryOf) => entryOf.package)).toEqual(['@venizia/web']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].package).toBe('@venizia/kernel');
    expect(result.skipped[0].reason).toContain("unknown version '1.1.0+local'");
  });

  test('a package no source serves is named as not served, with the way out, and listed as skipped in a run over every package', () => {
    const app = appWith({
      dependencies: { '@venizia/kernel': '1.0.0', '@venizia/ghost': '3.0.0' },
    });
    const result = MigratePlan.plans({ releases, app, to: 'latest' });

    expect(result.plans.map((entryOf) => entryOf.package)).toEqual(['@venizia/kernel']);
    expect(result.skipped.map((entryOf) => entryOf.package)).toEqual(['@venizia/ghost']);
    expect(result.skipped[0].reason).toContain('not served by any atlas source');
    expect(() => plan({ app, package: '@venizia/ghost', to: 'latest' })).toThrow(
      /@venizia\/ghost is not served by any atlas source.*atlas\.sources.*vulcan x atlas pull/s,
    );
  });

  test('a package named by the caller keeps the hard error', () => {
    const app = appWith({ dependencies: { '@venizia/kernel': '1.1.0+local' } });

    expect(() => plan({ app, to: 'latest' })).toThrow(/unknown version '1.1.0\+local'/);
  });

  test('latest from a prerelease newer than the newest stable is a downgrade with a note; the semantics stay', () => {
    const app = appWith({});
    const [toLatest] = plan({ app, from: '1.3.0-0', to: 'latest' }).plans;
    const [toVersion] = plan({ app, from: '1.3.0-0', to: '1.2.1' }).plans;
    const [upgrade] = plan({ app, from: '1.0.0', to: 'latest' }).plans;

    expect(toLatest.direction).toBe('downgrade');
    expect(toLatest.note).toContain('latest');
    expect(toLatest.note).toContain('next');
    expect(toVersion.note).toBeUndefined();
    expect(upgrade.note).toBeUndefined();
  });

  test('a missing app directory is invalid params naming it, never a raw ENOENT', () => {
    const missing = join(tmpdir(), 'atlas-plan-does-not-exist');

    expect(() => plan({ app: missing, from: '1.0.0', to: '1.2.0' })).toThrow(
      `app directory not found: ${missing}`,
    );
  });

  test('an unreadable file is counted on the plan, not an abort', () => {
    const app = appWith({
      files: { ...USES, 'src/locked.ts': "import { Thing } from '@venizia/kernel';\n" },
    });

    chmodSync(join(app, 'src', 'locked.ts'), 0o000);

    const [result] = plan({ app, from: '1.0.0', to: '1.2.0' }).plans;

    chmodSync(join(app, 'src', 'locked.ts'), 0o644);

    expect(result.unreadable).toEqual(['src/locked.ts']);
    expect(result.steps[0].touches).toHaveLength(1);
  });

  test('C14: planning writes nothing in the app', () => {
    const app = appWith({ files: USES });
    const before = treeHash({ root: app });

    plan({ app, from: '1.0.0', to: '1.2.0' });

    expect(treeHash({ root: app })).toBe(before);
  });
});
