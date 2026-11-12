import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrateReport, MigratePlan } from '@/migrations';
import type { IMigrationResult } from '@/migrations';
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

describe('MigrateReport.markdown', () => {
  test('prints the plan note, the skipped packages and the files not read, and says what the scan covers', () => {
    const text = MigrateReport.markdown({
      result: {
        app: '/app',
        skipped: [{ package: '@venizia/x', reason: "unknown version '1.0.0+local'" }],
        plans: [
          {
            package: '@venizia/kernel',
            from: '1.3.0-0',
            to: '1.2.1',
            direction: 'downgrade',
            target: 'release table',
            note: 'latest is older than the installed 1.3.0-0',
            steps: [],
            unstructured: [],
            unreadable: ['src/locked.ts'],
          },
        ],
      },
    });

    expect(text).toContain('Note: latest is older than the installed 1.3.0-0');
    expect(text).toContain('Skipped @venizia/x: unknown version');
    expect(text).toContain('Not read (1): src/locked.ts');
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
    expect(text).toContain('An upgrade: 1 of 1 changes found in your code.');
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

    expect(text).toContain('A downgrade: 0 of 1 changes found in your code.');
    expect(text).toContain('### No static import found');
    expect(text).toContain('Use Thing.make() again');
  });
});
