import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrateReport, MigratePlan } from '@/migrations';
import type { IMigrationResult, IMigrationTouch } from '@/migrations';
import { Transport } from '@/protocol';
import { ReleaseStore } from '@/releases';
import type { IReleaseTable } from '@/releases';
import { SourceReleases } from '@/sources';
import { MigrateTool } from '@/tools';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const table = (opts: { dir: string; name: string; id: string }): IReleaseTable => ({
  livePackages: [opts.dir],
  packageMap: [{ dir: opts.dir, name: opts.name, aliases: [] }],
  releases: {
    [opts.dir]: [
      { version: '2.0.0', date: '2026-03-01', sha: 'b', order: 2 },
      { version: '1.0.0', date: '2026-01-01', sha: 'a', order: 0 },
    ],
  },
  changelogs: [
    {
      id: `changelog:2026-02-01-${opts.id}`,
      file: `2026-02-01-${opts.id}.md`,
      date: '2026-02-01',
      title: `Change ${opts.id}`,
      packages: [opts.name],
      kind: 'Breaking Change',
      order: 1,
      migration: [
        {
          id: opts.id,
          symbols: ['Thing.make'],
          upgrade: { before: 'Thing.make()', after: 'ThingFactory.build()' },
          downgrade: { steps: ['Use Thing.make() again'] },
          data: 'Stored values change.',
          codemod: 'rename-thing',
        },
      ],
    },
  ],
});

const appWith = (opts: { dependencies: Record<string, string> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-migrate-'));

  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: opts.dependencies }));
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { Thing } from '@venizia/kernel';\n\nThing.make();\n",
  );

  return root;
};

const KERNEL = new ReleaseStore({
  table: table({ dir: 'kernel', name: '@venizia/kernel', id: 'kernel-item' }),
});

const call = async (opts: { releases: ReleaseStore | SourceReleases; args: unknown }) =>
  MigrateTool.build({ releases: opts.releases }).call({ args: opts.args });

describe('the migrate tool', () => {
  test('C15.1: it answers the plan the engine builds, as JSON-able data', async () => {
    const app = appWith({ dependencies: { '@venizia/kernel': '1.0.0' } });
    const answer = await call({
      releases: KERNEL,
      args: { package: '@venizia/kernel', to: '2.0.0', app },
    });

    expect(JSON.parse(JSON.stringify(answer))).toEqual(
      JSON.parse(
        JSON.stringify(
          MigratePlan.plans({ releases: KERNEL, app, package: '@venizia/kernel', to: '2.0.0' }),
        ),
      ),
    );
  });

  test('a package that lives in the second source of a composite is planned too', async () => {
    const composite = new SourceReleases({
      sources: [
        { name: 'one', releases: KERNEL },
        {
          name: 'two',
          releases: new ReleaseStore({
            table: table({ dir: 'extra', name: '@venizia/extra', id: 'extra-item' }),
          }),
        },
      ],
    });
    const app = appWith({
      dependencies: { '@venizia/kernel': '1.0.0', '@venizia/extra': '1.0.0' },
    });
    const raw = await call({ releases: composite, args: { to: 'latest', app } });
    const answer: IMigrationResult = JSON.parse(JSON.stringify(raw));

    expect(answer.plans.map((plan) => plan.package).sort()).toEqual([
      '@venizia/extra',
      '@venizia/kernel',
    ]);
    expect(answer.plans.flatMap((plan) => plan.steps.map((step) => step.id)).sort()).toEqual([
      'extra-item',
      'kernel-item',
    ]);
  });

  test('a call without `to` is -32602 naming the field', async () => {
    const transport = new Transport({
      tools: [MigrateTool.build({ releases: KERNEL })],
      serverName: 'test',
      serverVersion: '0',
    });
    const line = await transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'migrate', arguments: {} },
      }),
    });
    const reply = JSON.parse(line ?? 'null');

    expect(reply.error.code).toBe(-32602);
    expect(reply.error.message).toContain('to');
  });
});

const stepWith = (opts: { id: string; symbols: string[]; touches: IMigrationTouch[] }) => ({
  id: opts.id,
  entry: 'changelog:2026-02-01-x',
  title: 'X',
  date: '2026-02-01',
  symbols: opts.symbols,
  change: { steps: ['Do it'] },
  touches: opts.touches,
});

const planWith = (opts: { steps: ReturnType<typeof stepWith>[] }): IMigrationResult => ({
  app: '/app',
  skipped: [],
  unserved: [],
  plans: [
    {
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '2.0.0',
      direction: 'upgrade',
      target: 'version',
      entries: 1,
      steps: opts.steps,
      unstructured: [],
      unreadable: [],
    },
  ],
});

describe('MigrateReport.markdown', () => {
  test('an `export *` hit is listed as re-exported, one line per export, and the step is not "found"', () => {
    const text = MigrateReport.markdown({
      result: planWith({
        steps: [
          stepWith({
            id: 'only-reexported',
            symbols: ['Alpha', 'Beta'],
            touches: [
              { file: 'src/index.ts', line: 4, symbol: 'Alpha', kind: 're-export' },
              { file: 'src/index.ts', line: 4, symbol: 'Beta', kind: 're-export' },
            ],
          }),
          stepWith({
            id: 'used',
            symbols: ['Gamma'],
            touches: [{ file: 'src/a.ts', line: 2, symbol: 'Gamma', kind: 'name' }],
          }),
        ],
      }),
    });

    expect(text).toContain('2 structured steps, 1 found in your code, 1 only re-exported.');
    expect(text).toContain(
      'Re-exported by your code (your consumers may be hit; your own code needs no change):\n- src/index.ts:4 (Alpha, Beta)',
    );
    expect(text).not.toContain('Found in your code:\n- src/index.ts');
    expect(text.indexOf('### used')).toBeLessThan(text.indexOf('### only-reexported'));
  });

  test('a module symbol is a count and a hint; --verbose lists the places', () => {
    const result = planWith({
      steps: [
        stepWith({
          id: 'entry-import',
          symbols: ['@venizia/kernel'],
          touches: [
            { file: 'src/a.ts', line: 1, symbol: '@venizia/kernel', kind: 'module' },
            { file: 'src/b.ts', line: 3, symbol: '@venizia/kernel', kind: 'module' },
          ],
        }),
      ],
    });
    const short = MigrateReport.markdown({ result });
    const long = MigrateReport.markdown({ result, verbose: true });

    expect(short).toContain(
      '2 places import `@venizia/kernel`. The import itself is not what breaks',
    );
    expect(short).toContain('--verbose');
    expect(short).not.toContain('src/a.ts');
    expect(long).toContain('2 places import `@venizia/kernel`:\n- src/a.ts:1\n- src/b.ts:3');
  });

  test('a source atlas could not serve is a Warning at the top, so an answer from the rest never reads as complete', () => {
    const text = MigrateReport.markdown({
      result: {
        app: '/app',
        skipped: [],
        unserved: [],
        plans: [],
        notServed: {
          answeredFrom: ['app'],
          indexing: [],
          failed: [{ source: 'ignis', reason: 'fetch failed' }],
          message:
            'ignis could not be indexed (fetch failed) and is not searched; this answer covers only app',
        },
      },
    });

    expect(text).toContain('Warning: ignis could not be indexed (fetch failed)');
    expect(text.indexOf('Warning:')).toBeLessThan(text.indexOf('Places are found'));
  });

  test('prints the plan note, the skipped packages and the files not read, and says what the scan covers', () => {
    const text = MigrateReport.markdown({
      result: {
        app: '/app',
        skipped: [{ package: '@venizia/x', reason: "unknown version '1.0.0+local'" }],
        unserved: ['@venizia/vulcan', '@venizia/dev-configs'],
        plans: [
          {
            package: '@venizia/kernel',
            from: '1.3.0-0',
            to: '1.2.1',
            direction: 'downgrade',
            target: 'release table',
            note: 'latest is older than the installed 1.3.0-0',
            entries: 2,
            steps: [],
            unstructured: [
              { id: 'changelog:2026-02-01-x', title: 'X', date: '2026-02-01' },
              { id: 'changelog:2026-02-02-y', title: 'Y', date: '2026-02-02' },
            ],
            unreadable: ['src/locked.ts'],
          },
          {
            package: '@venizia/web',
            from: '1.0.0',
            to: '1.1.0',
            direction: 'upgrade',
            target: 'version',
            entries: 0,
            steps: [],
            unstructured: [],
            unreadable: [],
          },
        ],
      },
    });

    expect(text).toContain('Note: latest is older than the installed 1.3.0-0');
    expect(text).toContain('Skipped @venizia/x: unknown version');
    // Packages no source serves: one short line, never the long error.
    expect(text).toContain(
      'Not served by any atlas source: @venizia/vulcan, @venizia/dev-configs.',
    );
    expect(text).not.toContain('Skipped @venizia/vulcan');
    expect(text).toContain('Not read (1): src/locked.ts');
    // Entries and no structured step: the headline says so and does not read as clean.
    expect(text).toContain(
      'A downgrade: 2 changelog entries in the window; 0 structured steps, 0 found in your code; 2 breaking entries have no structured steps, so the scan could not check them.',
    );
    // An empty window says it is empty and why it proves nothing.
    expect(text).toContain('No changelog entry falls between 1.0.0 and 1.1.0 in the release table');
    expect(text).toContain('proves nothing');
    expect(text).not.toContain('0 of 0');
    expect(text).toContain('static imports');
  });

  test('lists what reaches the app first, with file:line, the steps, data and codemod', () => {
    const app = appWith({ dependencies: { '@venizia/kernel': '1.0.0' } });
    const result = MigratePlan.plans({
      releases: KERNEL,
      app,
      package: '@venizia/kernel',
      to: 'latest',
    });
    const text = MigrateReport.markdown({ result });

    expect(text).toContain('## @venizia/kernel: 1.0.0 to 2.0.0');
    expect(text).toContain(
      'An upgrade: 1 changelog entry in the window; 1 structured step, 1 found in your code.',
    );
    expect(text).toContain('src/a.ts:3 (Thing.make)');
    expect(text).toContain('ThingFactory.build()');
    expect(text).toContain('Data: Stored values change.');
    expect(text).toContain('Codemod: `rename-thing`');
    expect(text).toContain('not the registry');
    expect(text.endsWith('\n')).toBe(true);
  });

  test('a downgrade prints the downgrade steps; an item the app does not use is listed apart', () => {
    const app = appWith({ dependencies: { '@venizia/kernel': '2.0.0' } });
    const other = new ReleaseStore({
      table: {
        ...table({ dir: 'kernel', name: '@venizia/kernel', id: 'unused' }),
        changelogs: table({ dir: 'kernel', name: '@venizia/kernel', id: 'unused' }).changelogs.map(
          (entry) => ({
            ...entry,
            migration: entry.migration?.map((item) => ({ ...item, symbols: ['Nowhere'] })),
          }),
        ),
      },
    });
    const result = MigratePlan.plans({
      releases: other,
      app,
      package: '@venizia/kernel',
      to: '1.0.0',
    });
    const text = MigrateReport.markdown({ result });

    expect(text).toContain(
      'A downgrade: 1 changelog entry in the window; 1 structured step, 0 found in your code.',
    );
    expect(text).toContain('### No static import found');
    expect(text).toContain('Use Thing.make() again');
  });
});
