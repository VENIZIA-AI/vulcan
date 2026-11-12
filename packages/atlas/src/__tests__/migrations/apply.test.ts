import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MigrateApply, MigratePlan } from '@/migrations';
import type { TMigrationItem } from '@/migrations';
import { ReleaseStore } from '@/releases';
import type { IChangelogRecord, IReleaseTable } from '@/releases';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const item = (opts: { id: string; codemod?: string }): TMigrationItem => ({
  id: opts.id,
  symbols: ['Thing'],
  upgrade: { steps: [`up ${opts.id}`] },
  downgrade: { steps: [`down ${opts.id}`] },
  codemod: opts.codemod,
});

const entry = (opts: {
  slug: string;
  order: number;
  items: TMigrationItem[];
}): IChangelogRecord => ({
  id: `changelog:2026-02-0${opts.order}-${opts.slug}`,
  file: `2026-02-0${opts.order}-${opts.slug}.md`,
  date: `2026-02-0${opts.order}`,
  title: opts.slug,
  packages: ['@venizia/kernel'],
  kind: 'Breaking Change',
  order: opts.order,
  migration: opts.items,
});

const TABLE: IReleaseTable = {
  livePackages: ['kernel'],
  packageMap: [{ dir: 'kernel', name: '@venizia/kernel', aliases: [] }],
  releases: {
    kernel: [
      { version: '1.2.0', date: '2026-03-01', sha: 'c', order: 4 },
      { version: '1.1.0', date: '2026-02-10', sha: 'b', order: 2 },
      { version: '1.0.0', date: '2026-01-01', sha: 'a', order: 0 },
    ],
  },
  changelogs: [
    entry({
      slug: 'first',
      order: 1,
      items: [item({ id: 'a-item', codemod: 'cm-a' }), item({ id: 'plain-item' })],
    }),
    entry({
      slug: 'second',
      order: 3,
      items: [
        item({ id: 'b-item', codemod: 'cm-b' }),
        item({ id: 'a-again', codemod: 'cm-a' }),
        item({ id: 'irr-item', codemod: 'irreversible' }),
      ],
    }),
  ],
};

const releases = new ReleaseStore({ table: TABLE });

const STUB = (opts: { log: string }): string => `#!/bin/sh
echo "$@" >> "${opts.log}"
case "$2" in
  failing) echo "boom" >&2; exit 1 ;;
  irreversible) case " $* " in *" --reverse "*) echo "not reversible"; exit 2 ;; esac ;;
esac
echo "rewrote $2"
exit 0
`;

/** An app in a clean git repository with a stub `devz` that logs every call; `log` is read back by the tests. */
const appWith = (opts: { git?: boolean; devz?: boolean } = {}): { app: string; log: string } => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-apply-'));
  const app = join(root, 'app');
  const log = join(root, 'devz.log');

  roots.push(root);
  mkdirSync(join(app, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ dependencies: { '@venizia/kernel': '1.0.0' } }),
  );
  mkdirSync(dirname(join(app, 'src', 'a.ts')), { recursive: true });
  writeFileSync(join(app, 'src', 'a.ts'), "import { Thing } from '@venizia/kernel';\n");
  writeFileSync(log, '');

  if (opts.devz !== false) {
    writeFileSync(join(app, 'node_modules', '.bin', 'devz'), STUB({ log }));
    chmodSync(join(app, 'node_modules', '.bin', 'devz'), 0o755);
  }

  if (opts.git !== false) {
    writeFileSync(join(app, '.gitignore'), 'node_modules\n');

    const run = (args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: app,
        stdio: 'ignore',
      });
    };

    run(['init', '-q', '-b', 'develop']);
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
  }

  return { app, log };
};

const apply = (opts: { app: string; from: string; to: string; force?: boolean }) => {
  const out: string[] = [];
  const err: string[] = [];
  const result = MigratePlan.plans({
    releases,
    app: opts.app,
    package: '@venizia/kernel',
    from: opts.from,
    to: opts.to,
  });
  const code = MigrateApply.run({
    result,
    force: opts.force === true,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });

  return { code, out: out.join(''), err: err.join('') };
};

const calls = (opts: { log: string }): string[] =>
  readFileSync(opts.log, 'utf8').split('\n').filter(Boolean);

describe('MigrateApply.run', () => {
  test('C16.1: each linked codemod runs once, in plan order, with --write, on the app', () => {
    const { app, log } = appWith();
    const result = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(calls({ log })).toEqual([
      'codemod cm-a . --write',
      'codemod cm-b . --write',
      'codemod irreversible . --write',
    ]);
    expect(result.code).toBe(0);
  });

  test('C16.2: the steps that stay manual are printed; a step a codemod ran is listed as applied', () => {
    const { app } = appWith();
    const { out } = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(out).toContain('plain-item');
    expect(out).toContain('up plain-item');
    expect(out).toContain('Ran `cm-a`');
    expect(out).not.toContain('up a-item');
  });

  test('C17: a downgrade runs the codemods with --reverse; one that is not reversible prints its downgrade steps', () => {
    const { app, log } = appWith();

    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ dependencies: { '@venizia/kernel': '1.2.0' } }),
    );
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', 'bump'],
      {
        cwd: app,
        stdio: 'ignore',
      },
    );

    const { code, out } = apply({ app, from: '1.2.0', to: '1.0.0' });

    expect(calls({ log })).toEqual([
      'codemod irreversible . --write --reverse',
      'codemod cm-a . --write --reverse',
      'codemod cm-b . --write --reverse',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('not reversible');
    expect(out).toContain('down irr-item');
    expect(out).not.toContain('down a-again');
  });

  test('a codemod that fails stops the run, exits 1 and names it; later codemods do not run', () => {
    const failing = new ReleaseStore({
      table: {
        ...TABLE,
        changelogs: [
          entry({
            slug: 'x',
            order: 1,
            items: [item({ id: 'one', codemod: 'failing' }), item({ id: 'two', codemod: 'cm-b' })],
          }),
        ],
      },
    });
    const { app, log } = appWith();
    const out: string[] = [];
    const err: string[] = [];
    const code = MigrateApply.run({
      result: MigratePlan.plans({
        releases: failing,
        app,
        package: '@venizia/kernel',
        from: '1.0.0',
        to: '1.1.0',
      }),
      force: false,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });

    expect(code).toBe(1);
    expect(err.join('')).toContain('failing');
    expect(err.join('')).toContain('boom');
    expect(calls({ log })).toEqual(['codemod failing . --write']);
  });

  test('C18: a dirty work tree is refused without --force, and no codemod runs', () => {
    const { app, log } = appWith();

    writeFileSync(join(app, 'src', 'a.ts'), '// edited\n');

    const refused = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(refused.code).toBe(1);
    expect(refused.err).toContain('uncommitted');
    expect(calls({ log })).toEqual([]);

    const forced = apply({ app, from: '1.0.0', to: '1.2.0', force: true });

    expect(forced.code).toBe(0);
    expect(calls({ log })).toHaveLength(3);
  });

  test('an app outside any git repository is refused without --force', () => {
    const { app, log } = appWith({ git: false });
    const refused = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(refused.code).toBe(1);
    expect(refused.err).toContain('git');
    expect(calls({ log })).toEqual([]);
    expect(apply({ app, from: '1.0.0', to: '1.2.0', force: true }).code).toBe(0);
  });

  test('without devz installed the run exits 1 and still prints every step as manual', () => {
    const { app } = appWith({ devz: false });
    const result = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(result.code).toBe(1);
    expect(result.err).toContain('devz');
    expect(result.out).toContain('up a-item');
  });

  test('a plan with no codemod writes nothing, needs no devz and no clean tree', () => {
    const { app, log } = appWith({ devz: false });

    writeFileSync(join(app, 'src', 'a.ts'), '// edited\n');

    const none = new ReleaseStore({
      table: {
        ...TABLE,
        changelogs: [entry({ slug: 'p', order: 1, items: [item({ id: 'plain-only' })] })],
      },
    });
    const out: string[] = [];
    const code = MigrateApply.run({
      result: MigratePlan.plans({
        releases: none,
        app,
        package: '@venizia/kernel',
        from: '1.0.0',
        to: '1.1.0',
      }),
      force: false,
      out: (text) => out.push(text),
      err: () => {},
    });

    expect(code).toBe(0);
    expect(out.join('')).toContain('plain-only');
    expect(calls({ log })).toEqual([]);
  });

  test('the plan names the apply command when a step links a codemod', () => {
    const { app } = appWith();
    const [plan] = MigratePlan.plans({
      releases,
      app,
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '1.2.0',
    }).plans;

    expect(plan.apply).toBe(
      `vulcan migrate apply --package @venizia/kernel --from 1.0.0 --to 1.2.0 --app ${app}`,
    );
  });
});
