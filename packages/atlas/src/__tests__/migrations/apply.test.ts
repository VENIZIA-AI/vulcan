import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { MigrateApply, MigratePlan, MigrateReport } from '@/migrations';
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
  packageMap: [
    { dir: 'kernel', name: '@venizia/kernel', aliases: [] },
    { dir: 'dev-configs', name: '@venizia/dev-configs', aliases: [] },
    { dir: 'ardor', name: '@venizia/ardor', aliases: [] },
  ],
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

/** The npm names of the source project's own packages: where its codemod runner may be installed from. */
const PROJECT_PACKAGES = ['@venizia/dev-configs', '@venizia/ardor'];

const releases = new ReleaseStore({ codemodPackages: PROJECT_PACKAGES, table: TABLE });

const STUB = (opts: { log: string }): string => `#!/bin/sh
echo "$@" >> "${opts.log}"
case "$2" in
  failing) echo "boom" >&2; exit 1 ;;
  irreversible) case " $* " in *" --reverse "*) echo "not reversible"; exit 2 ;; esac ;;
esac
echo "rewrote $2"
exit 0
`;

/**
 * A codemod runner installed the way a package manager does: the binary inside the package `pkg`, a link to it in
 * `.bin`. A runner is only run from inside a package of the source that serves it.
 */
const installRunner = (opts: {
  nodeModules: string;
  name: string;
  pkg?: string;
  script: string;
}): void => {
  const target = join(opts.nodeModules, opts.pkg ?? '@venizia/dev-configs', 'bin', opts.name);
  const link = join(opts.nodeModules, '.bin', opts.name);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, opts.script);
  chmodSync(target, 0o755);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(relative(dirname(link), target), link);
};

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
    installRunner({ nodeModules: join(app, 'node_modules'), name: 'devz', script: STUB({ log }) });
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
      codemodPackages: PROJECT_PACKAGES,
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
      codemodPackages: PROJECT_PACKAGES,
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

  test('a plan made while a source was not served is refused unless --force: it may be incomplete', () => {
    const { app, log } = appWith();
    const out: string[] = [];
    const err: string[] = [];
    const result = MigratePlan.plans({
      releases,
      app,
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '1.2.0',
    });
    const partial = {
      ...result,
      notServed: {
        answeredFrom: ['app'],
        indexing: [],
        failed: [{ source: 'ignis', reason: 'fetch failed' }],
        message: 'ignis could not be indexed (fetch failed) and is not searched',
      },
    };
    const code = MigrateApply.run({
      result: partial,
      force: false,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });

    expect(code).toBe(1);
    expect(err.join('')).toContain('ignis could not be indexed');
    expect(calls({ log })).toEqual([]);
    expect(MigrateApply.run({ result: partial, force: true, out: () => {}, err: () => {} })).toBe(
      0,
    );
  });

  test('a codemod name that is not lower-case words joined by - is refused before anything runs', () => {
    const { app, log } = appWith();
    const out: string[] = [];
    const err: string[] = [];
    const bad = new ReleaseStore({
      codemodPackages: PROJECT_PACKAGES,
      table: {
        ...TABLE,
        changelogs: [
          {
            ...entry({ slug: 'x', order: 1, items: [item({ id: 'one', codemod: 'cm-a' })] }),
            // A table from an older or hostile source is not schema-checked: the name is checked again here.
            migration: [{ ...item({ id: 'one' }), codemod: '--write' }],
          },
        ],
      },
    });
    const code = MigrateApply.run({
      result: MigratePlan.plans({
        releases: bad,
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
    expect(err.join('')).toContain("codemod name '--write'");
    expect(calls({ log })).toEqual([]);
  });

  test('devz is looked for from the app up to its git root, never beyond', () => {
    const { app, log } = appWith({ devz: false });
    const parentBin = join(dirname(app), 'node_modules', '.bin');

    mkdirSync(parentBin, { recursive: true });
    writeFileSync(join(parentBin, 'devz'), STUB({ log }));
    chmodSync(join(parentBin, 'devz'), 0o755);

    const result = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(result.code).toBe(1);
    expect(result.err).toContain('devz is not installed');
    expect(calls({ log })).toEqual([]);
  });

  test('an app inside a larger git work tree finds the devz at that work tree root', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-apply-mono-'));
    const log = join(root, 'devz.log');
    const app = join(root, 'apps', 'web');

    roots.push(root);
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(app, 'src'), { recursive: true });
    installRunner({ nodeModules: join(root, 'node_modules'), name: 'devz', script: STUB({ log }) });
    writeFileSync(join(root, '.gitignore'), 'node_modules\n');
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ dependencies: { '@venizia/kernel': '1.0.0' } }),
    );
    writeFileSync(log, '');
    execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'i'], {
      cwd: root,
      stdio: 'ignore',
    });
    // The log file sits in the work tree: ignore it so the tree stays clean.
    writeFileSync(join(root, '.git', 'info', 'exclude'), 'devz.log\n');

    const result = apply({ app, from: '1.0.0', to: '1.2.0' });

    expect(result.code).toBe(0);
    expect(calls({ log })).toHaveLength(3);
  });

  test('with --force outside git only the app directory is searched', () => {
    const { app, log } = appWith({ git: false, devz: false });
    const parentBin = join(dirname(app), 'node_modules', '.bin');

    mkdirSync(parentBin, { recursive: true });
    writeFileSync(join(parentBin, 'devz'), STUB({ log }));
    chmodSync(join(parentBin, 'devz'), 0o755);

    const result = apply({ app, from: '1.0.0', to: '1.2.0', force: true });

    expect(result.code).toBe(1);
    expect(result.err).toContain('devz is not installed');
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

describe("MigrateApply.run: the runner is the source project's own", () => {
  const withRunner = (opts: { codemodCommand?: string[] }) =>
    new ReleaseStore({
      codemodPackages: PROJECT_PACKAGES,
      table: TABLE,
      codemodCommand: opts.codemodCommand,
    });

  const runWith = (opts: {
    store: ReleaseStore;
    app: string;
    mutate?: (words: unknown) => void;
  }) => {
    const out: string[] = [];
    const err: string[] = [];
    const result = MigratePlan.plans({
      releases: opts.store,
      app: opts.app,
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '1.1.0',
    });

    for (const plan of result.plans) {
      opts.mutate?.(plan);
    }

    const code = MigrateApply.run({
      result,
      force: false,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });

    return { code, out: out.join(''), err: err.join(''), result };
  };

  test('a source that declares its runner has its codemods run by it, never by devz', () => {
    const { app, log } = appWith({ devz: false });

    installRunner({
      nodeModules: join(app, 'node_modules'),
      name: 'ardor',
      pkg: '@venizia/ardor',
      script: STUB({ log }),
    });

    const { code, result, out } = runWith({
      store: withRunner({ codemodCommand: ['ardor', 'codemod'] }),
      app,
    });

    expect(result.plans[0].codemodCommand).toEqual(['ardor', 'codemod']);
    expect(code).toBe(0);
    expect(calls({ log })).toEqual(['codemod cm-a . --write']);
    expect(out).toContain('Command: `ardor codemod cm-a . --write`');
    expect(MigrateReport.markdown({ result })).toContain(
      'it runs `ardor codemod <name> . --write`',
    );
  });

  test('a source with no setting runs devz codemod, and the plan says so', () => {
    const { app, log } = appWith();
    const { result } = runWith({ store: withRunner({}), app });

    expect(result.plans[0].codemodCommand).toEqual(['devz', 'codemod']);
    expect(calls({ log })).toEqual(['codemod cm-a . --write']);
  });

  test('a runner the app does not have is named, nothing runs, and the steps stay manual', () => {
    const { app, log } = appWith();
    const { code, err, out } = runWith({
      store: withRunner({ codemodCommand: ['ardor', 'codemod'] }),
      app,
    });

    expect(code).toBe(1);
    expect(err).toContain('ardor is not installed');
    expect(calls({ log })).toEqual([]);
    expect(out).toContain('up a-item');
  });

  test('a plan whose runner words are not allowed is refused before anything runs', () => {
    const { app, log } = appWith();
    const { code, err } = runWith({
      store: withRunner({}),
      app,
      mutate: (plan) => {
        if (typeof plan === 'object' && plan !== null) {
          Object.assign(plan, { codemodCommand: ['sh', '-c', 'x'] });
        }
      },
    });

    expect(code).toBe(1);
    expect(err).toContain('"-c"');
    expect(calls({ log })).toEqual([]);
  });
});

describe('MigrateApply.run: a runner is run only from a package of its source', () => {
  const runFor = (opts: { app: string }) => {
    const out: string[] = [];
    const err: string[] = [];
    const result = MigratePlan.plans({
      releases: new ReleaseStore({
        codemodPackages: PROJECT_PACKAGES,
        table: TABLE,
        codemodCommand: ['rimraf', 'codemod'],
      }),
      app: opts.app,
      package: '@venizia/kernel',
      from: '1.0.0',
      to: '1.1.0',
    });
    const code = MigrateApply.run({
      result,
      force: false,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });

    return { code, out: out.join(''), err: err.join('') };
  };

  test('a bin of a package the source does not serve is refused; nothing runs and the steps stay manual', () => {
    const { app, log } = appWith({ devz: false });

    installRunner({
      nodeModules: join(app, 'node_modules'),
      name: 'rimraf',
      pkg: 'rimraf',
      script: STUB({ log }),
    });

    const { code, err, out } = runFor({ app });

    expect(code).toBe(1);
    expect(err).toContain('not inside an installed package of the source');
    expect(calls({ log })).toEqual([]);
    expect(out).toContain('up a-item');
  });

  test('a link that escapes the package is refused, even when the package is the right one', () => {
    const { app, log } = appWith({ devz: false });
    const outside = mkdtempSync(join(tmpdir(), 'atlas-apply-outside-'));

    roots.push(outside);
    writeFileSync(join(outside, 'rimraf'), STUB({ log }));
    chmodSync(join(outside, 'rimraf'), 0o755);
    mkdirSync(join(app, 'node_modules', '@venizia', 'dev-configs', 'bin'), { recursive: true });
    symlinkSync(
      join(outside, 'rimraf'),
      join(app, 'node_modules', '@venizia', 'dev-configs', 'bin', 'rimraf'),
    );
    mkdirSync(join(app, 'node_modules', '.bin'), { recursive: true });
    symlinkSync('../@venizia/dev-configs/bin/rimraf', join(app, 'node_modules', '.bin', 'rimraf'));

    const { code, err } = runFor({ app });

    expect(code).toBe(1);
    expect(err).toContain('not inside an installed package');
    expect(calls({ log })).toEqual([]);
  });

  test('the bin of a package the source serves runs', () => {
    const { app, log } = appWith({ devz: false });

    installRunner({
      nodeModules: join(app, 'node_modules'),
      name: 'rimraf',
      pkg: '@venizia/dev-configs',
      script: STUB({ log }),
    });

    const { code } = runFor({ app });

    expect(code).toBe(0);
    expect(calls({ log })).toEqual(['codemod cm-a . --write']);
  });
});

describe('MigrateApply.run: the allow-list is the validated project, never the table', () => {
  test('a package list of a tampered plan that names `..` or an empty name allows nothing', () => {
    for (const hostile of [['..'], [''], ['../..'], ['.']]) {
      const { app, log } = appWith({ devz: false });

      installRunner({
        nodeModules: join(app, 'node_modules'),
        name: 'rimraf',
        pkg: 'rimraf',
        script: STUB({ log }),
      });

      const out: string[] = [];
      const err: string[] = [];
      const result = MigratePlan.plans({
        releases: new ReleaseStore({
          table: TABLE,
          codemodCommand: ['rimraf', 'codemod'],
          codemodPackages: ['@venizia/dev-configs'],
        }),
        app,
        package: '@venizia/kernel',
        from: '1.0.0',
        to: '1.1.0',
      });

      result.plans[0].codemodPackages = hostile;

      const code = MigrateApply.run({
        result,
        force: false,
        out: (text) => out.push(text),
        err: (text) => err.push(text),
      });

      expect(code).toBe(1);
      expect(calls({ log })).toEqual([]);
    }
  });

  test('a store reads the allow-list from the project it is given, not from the names in its table', () => {
    const tampered = new ReleaseStore({
      table: { ...TABLE, packageMap: [{ dir: 'x', name: '..', aliases: [] }] },
    });

    expect(tampered.codemodPackagesOf()).toEqual([]);
  });
});

describe('MigrateApply.run: a plan from a server that sends no step direction (C7)', () => {
  test('a step with none goes the way its plan does: a rollback is reversed', () => {
    const { app, log } = appWith();
    const text = JSON.stringify({
      app,
      plans: [
        {
          package: '@venizia/kernel',
          from: '1.1.0',
          to: '1.0.0',
          direction: 'downgrade',
          target: 'version',
          entries: 1,
          apply: 'vulcan migrate apply',
          codemodCommand: ['devz', 'codemod'],
          codemodPackages: PROJECT_PACKAGES,
          steps: [
            {
              id: 'a-item',
              entry: 'changelog:2026-02-01-x',
              title: 'a',
              date: '2026-02-01',
              symbols: ['Thing'],
              change: { steps: ['down'] },
              codemod: 'cm-a',
              touches: [],
            },
          ],
          unstructured: [],
          unreadable: [],
        },
      ],
      skipped: [],
      unserved: [],
    });
    const code = MigrateApply.run({
      result: JSON.parse(text),
      force: false,
      out: () => undefined,
      err: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls({ log })).toEqual(['codemod cm-a . --write --reverse']);
  });
});

describe('MigrateApply.run: each step runs in its own direction (C7)', () => {
  const step = (opts: { id: string; direction: 'upgrade' | 'downgrade'; codemod?: string }) => ({
    id: opts.id,
    entry: `changelog:0.4.5#${opts.id}`,
    title: opts.id,
    date: 'in progress',
    symbols: ['Thing'],
    direction: opts.direction,
    change: { steps: [`${opts.direction} ${opts.id}`] },
    codemod: opts.codemod,
    touches: [],
  });

  test('--reverse only on a downgrade step; the same codemod on both sides runs once each way', () => {
    const { app, log } = appWith();
    const out: string[] = [];
    const err: string[] = [];
    const code = MigrateApply.run({
      result: {
        app,
        plans: [
          {
            package: '@venizia/kernel',
            from: '1.0.0',
            to: '1.1.0',
            direction: 'upgrade',
            target: 'version',
            entries: 3,
            apply: 'vulcan migrate apply',
            codemodCommand: ['devz', 'codemod'],
            codemodPackages: PROJECT_PACKAGES,
            steps: [
              step({ id: 'gone-item', direction: 'downgrade', codemod: 'cm-a' }),
              step({ id: 'gone-item', direction: 'upgrade', codemod: 'cm-a' }),
              step({ id: 'new-item', direction: 'upgrade', codemod: 'cm-b' }),
            ],
            unstructured: [],
            unreadable: [],
          },
        ],
        skipped: [],
        unserved: [],
      },
      force: false,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });

    expect(code).toBe(0);
    expect(calls({ log })).toEqual([
      'codemod cm-a . --write --reverse',
      'codemod cm-a . --write',
      'codemod cm-b . --write',
    ]);
    // Both steps of the changed item are done: neither is left manual because its twin ran.
    expect(out.join('')).not.toContain('Still manual');
    expect(out.join('')).toContain('in reverse');
  });

  test('a downgrade step whose codemod is not reversible stays manual while its upgrade twin is applied', () => {
    const { app, log } = appWith();
    const out: string[] = [];
    const code = MigrateApply.run({
      result: {
        app,
        plans: [
          {
            package: '@venizia/kernel',
            from: '1.0.0',
            to: '1.1.0',
            direction: 'upgrade',
            target: 'version',
            entries: 2,
            apply: 'vulcan migrate apply',
            codemodCommand: ['devz', 'codemod'],
            codemodPackages: PROJECT_PACKAGES,
            steps: [
              step({ id: 'irr-item', direction: 'downgrade', codemod: 'irreversible' }),
              step({ id: 'irr-item', direction: 'upgrade', codemod: 'irreversible' }),
            ],
            unstructured: [],
            unreadable: [],
          },
        ],
        skipped: [],
        unserved: [],
      },
      force: false,
      out: (text) => out.push(text),
      err: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls({ log })).toEqual([
      'codemod irreversible . --write --reverse',
      'codemod irreversible . --write',
    ]);
    expect(out.join('')).toContain('not reversible');
    expect(out.join('')).toContain('downgrade irr-item');
    expect(out.join('')).not.toContain('upgrade irr-item');
  });
});
