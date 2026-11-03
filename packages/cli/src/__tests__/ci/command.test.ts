import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { git } from '../git-repo.helper.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { commit, workspaceRepo } from './workspace.helper.ts';

afterAll(removeProjects);

const SRC = join(import.meta.dir, '..', '..');
const BASE = join(SRC, '..', 'base');

const ci = (opts: { root: string; args: string[] }) =>
  runCli({ args: ['ci', ...opts.args], cwd: opts.root, env: hermeticEnv() });

/** a <- b; c alone. `a` has every check, `b` only test, `c` typecheck and lint. */
const repo = (): { root: string; base: string } => {
  const root = workspaceRepo({
    packages: {
      a: { name: '@x/a', scripts: { typecheck: 't', lint: 'l', test: 't', compile: 'c' } },
      b: { name: '@x/b', dependencies: { '@x/a': 'workspace:*' }, scripts: { test: 't' } },
      c: { name: '@x/c', scripts: { typecheck: 't', lint: 'l' } },
    },
  });
  const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

  commit({ root, files: { 'packages/a/src/index.ts': 'export const a = 2;\n' } });

  return { root, base };
};

describe('vulcan ci affected', () => {
  test('--json: the base and head as commits, whether all are affected, and each package with its reason and checks', () => {
    const { root, base } = repo();
    const result = ci({ root, args: ['affected', '--base', base, '--json'] });
    const head = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      base,
      head,
      all: false,
      packages: [
        {
          name: '@x/a',
          dir: 'packages/a',
          reason: 'changed',
          checks: { typecheck: 'typecheck', lint: 'lint', test: 'test', compile: 'compile' },
        },
        { name: '@x/b', dir: 'packages/b', reason: 'dependent', checks: { test: 'test' } },
      ],
    });
  });

  test('the default output is one line per package: name, folder, reason, checks', () => {
    const { root, base } = repo();

    expect(ci({ root, args: ['affected', '--base', base] }).stdout).toBe(
      '@x/a  packages/a  changed  typecheck,lint,test,compile\n@x/b  packages/b  dependent  test\n',
    );
  });

  test('--names prints the names only; --check keeps the packages that have the check', () => {
    const { root, base } = repo();

    expect(ci({ root, args: ['affected', '--base', base, '--names'] }).stdout).toBe('@x/a\n@x/b\n');
    expect(
      ci({ root, args: ['affected', '--base', base, '--check', 'test', '--names'] }).stdout,
    ).toBe('@x/a\n@x/b\n');
    expect(
      ci({ root, args: ['affected', '--base', base, '--check', 'compile', '--names'] }).stdout,
    ).toBe('@x/a\n');
    expect(
      ci({ root, args: ['affected', '--base', base, '--check', 'lint', '--names'] }).stdout,
    ).toBe('@x/a\n');
    expect(
      JSON.parse(
        ci({ root, args: ['affected', '--base', base, '--check', 'compile', '--json'] }).stdout,
      ).packages,
    ).toHaveLength(1);
  });

  test('nothing affected is an empty list and exit 0', () => {
    const { root } = repo();
    const head = git({ cwd: root, args: ['rev-parse', 'HEAD'] });
    const result = ci({ root, args: ['affected', '--base', head, '--names'] });

    expect(result).toMatchObject({ code: 0, stdout: '' });
    expect(
      JSON.parse(ci({ root, args: ['affected', '--base', head, '--json'] }).stdout).packages,
    ).toEqual([]);
  });

  test('a global change says why in the human output and in --json', () => {
    const { root, base } = repo();

    commit({ root, files: { 'bun.lock': 'x\n' } });

    expect(ci({ root, args: ['affected', '--base', base] }).stdout).toStartWith(
      'all packages are affected: bun.lock\n',
    );

    const json = JSON.parse(ci({ root, args: ['affected', '--base', base, '--json'] }).stdout);

    expect(json).toMatchObject({ all: true, allBecause: 'bun.lock' });
    expect(json.packages.map((entry: { reason: string }) => entry.reason)).toEqual([
      'global',
      'global',
      'global',
    ]);
  });

  test('--head may name the checked-out commit', () => {
    const { root, base } = repo();

    expect(ci({ root, args: ['affected', '--base', base, '--head', 'HEAD', '--names'] }).code).toBe(
      0,
    );
    expect(
      ci({ root, args: ['affected', '--base', base, '--head', 'develop', '--names'] }).code,
    ).toBe(0);
  });

  test('bad input is exit 2 with the reason, and nothing on stdout', () => {
    const { root, base } = repo();
    const bad: [string[], string][] = [
      [['affected'], '--base is required'],
      [['affected', '--base'], 'needs a value'],
      [['affected', '--base', base, '--base', base], 'once'],
      [['affected', '--base', base, '--json', '--names'], 'cannot be combined'],
      [
        ['affected', '--base', base, '--check', 'build'],
        'must be one of typecheck, lint, test, compile',
      ],
      [['affected', '--base', 'no-such-ref'], 'no-such-ref is not a commit here'],
      [['affected', '--base', base, '--bogus'], 'unknown argument'],
      [['frobnicate'], 'usage: vulcan ci'],
      [[], 'usage: vulcan ci'],
    ];

    for (const [args, message] of bad) {
      const result = ci({ root, args });

      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr, args.join(' ')).toContain(message);
      expect(result.stdout, args.join(' ')).toBe('');
    }
  });

  test('a folder with no workspaces is exit 2 with the reason', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const result = ci({ root, args: ['affected', '--base', '0'.repeat(40)] });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('lists no workspaces');
  });

  test('a base of zeros is every package', () => {
    const { root } = repo();
    const result = ci({ root, args: ['affected', '--base', '0'.repeat(40), '--names'] });

    expect(result.stdout).toBe('@x/a\n@x/b\n@x/c\n');
  });

  test('help lists the command', () => {
    expect(runCli({ args: ['help'], cwd: createProject({ files: {} }) }).stdout).toContain(
      'ci affected --base',
    );
  });
});

describe('vulcan ci template', () => {
  for (const [name, file] of [
    ['github', 'github-actions.yml'],
    ['gitlab', 'gitlab-ci.yml'],
  ]) {
    test(`${name} prints the shipped file, byte for byte`, () => {
      const result = ci({ root: createProject({ files: {} }), args: ['template', name] });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(readFileSync(join(BASE, 'templates/ci', file), 'utf8'));
    });
  }

  test('an unknown system, none, or an extra word is exit 2', () => {
    const root = createProject({ files: {} });

    for (const args of [['template'], ['template', 'jenkins'], ['template', 'github', 'extra']]) {
      expect(ci({ root, args }).code, args.join(' ')).toBe(2);
    }
  });
});

describe('the templates', () => {
  const read = (file: string): string => readFileSync(join(BASE, 'templates/ci', file), 'utf8');
  const gitlab = Bun.YAML.parse(read('gitlab-ci.yml')) as Record<string, any>;
  const github = Bun.YAML.parse(read('github-actions.yml')) as Record<string, any>;

  test('GitHub: pull requests and pushes to develop, a full clone, the command, a matrix of package and check', () => {
    expect(github.on.pull_request.branches).toEqual(['develop', 'main']);
    expect(github.on.push.branches).toEqual(['develop']);
    expect(github.jobs.affected.steps[0].with['fetch-depth']).toBe(0);
    expect(github.jobs.affected.steps.at(-1).run).toContain(
      'bun x --no-install vulcan ci affected --base "$BASE" --json',
    );
    expect(github.jobs.check.needs).toBe('affected');
    expect(github.jobs.check.strategy.matrix).toContain('fromJSON(needs.affected.outputs.matrix)');
    expect(github.jobs.check.strategy['fail-fast']).toBe(false);
    expect(github.jobs.check.if).toContain('include[0] != null');
    expect(github.jobs.check.steps.at(-1).run).toBe('bun run --filter "$PKG" "$CHECK"');
  });

  test('GitLab: rules for merge requests and develop, a full clone, one job per check, each calling the command', () => {
    expect(gitlab.workflow.rules.map((rule: { if: string }) => rule.if)).toEqual([
      '$CI_PIPELINE_SOURCE == "merge_request_event"',
      '$CI_COMMIT_BRANCH == "develop"',
    ]);
    expect(gitlab.variables.GIT_DEPTH).toBe('0');
    expect(gitlab['.affected'].rules).toHaveLength(2);
    expect(gitlab['.affected'].script.join('\n')).toContain(
      'vulcan ci affected --base "$base" --check "$CHECK" --names',
    );
    expect(gitlab['.affected'].script[0]).toContain(
      'CI_MERGE_REQUEST_DIFF_BASE_SHA:-$CI_COMMIT_BEFORE_SHA',
    );

    for (const check of ['typecheck', 'lint', 'test', 'compile']) {
      expect(gitlab[check].extends).toBe('.affected');
      expect(gitlab[check].variables.CHECK).toBe(check);
    }
  });

  test('the docs page shows each template exactly as the command prints it', () => {
    const page = readFileSync(
      join(SRC, '..', '..', '..', 'docs/wiki/content/references/commands/ci.md'),
      'utf8',
    );

    for (const file of ['github-actions.yml', 'gitlab-ci.yml']) {
      expect(page, file).toContain(`\`\`\`yaml\n${read(file)}\`\`\``);
    }
  });

  test('every check a template runs is one the command reports', () => {
    const checks = ['typecheck', 'lint', 'test', 'compile'];

    expect(
      Object.keys(gitlab).filter(
        (key) => !key.startsWith('.') && !['workflow', 'variables'].includes(key),
      ),
    ).toEqual(checks);
  });

  test('the GitLab loop, run for real: only the affected packages that have the check, a note when none, a failure stops it', () => {
    const { root, base } = repo();
    const script = (gitlab['.affected'].script as string[]).slice(1).join('\n');
    const cli = join(SRC, 'cli.ts');
    const run = (opts: { check: string; base: string; step?: string }) =>
      Bun.spawnSync(
        [
          'sh',
          '-c',
          script
            .replace(/bun x --no-install vulcan/g, `${process.execPath} ${cli}`)
            .replace('bun run --filter "$name" "$CHECK"', opts.step ?? 'echo "ran $name $CHECK"'),
        ],
        { cwd: root, env: { ...hermeticEnv(), base: opts.base, CHECK: opts.check } },
      );

    expect(run({ check: 'compile', base }).stdout.toString()).toBe('ran @x/a compile\n');
    expect(run({ check: 'test', base }).stdout.toString()).toBe('ran @x/a test\nran @x/b test\n');
    expect(run({ check: 'lint', base }).stdout.toString()).toBe('ran @x/a lint\n');

    const failing = run({ check: 'test', base, step: 'echo "ran $name"; [ "$name" != "@x/a" ]' });

    expect(failing.exitCode).toBe(1);
    expect(failing.stdout.toString()).toBe('ran @x/a\n');

    // A name is one line, whatever is in it: no word splitting, no glob.
    const odd = workspaceRepo({ packages: { a: { name: 'two words *' }, b: { name: '@x/b' } } });
    const oddBase = git({ cwd: odd, args: ['rev-parse', 'HEAD'] });

    commit({ root: odd, files: { 'packages/a/x.ts': '1', 'packages/b/x.ts': '1' } });

    const oddRun = Bun.spawnSync(
      [
        'sh',
        '-c',
        script
          .replace(/bun x --no-install vulcan/g, `${process.execPath} ${cli}`)
          .replace('bun run --filter "$name" "$CHECK"', 'echo "ran [$name]"'),
      ],
      { cwd: odd, env: { ...hermeticEnv(), base: oddBase, CHECK: 'test' } },
    );

    expect(oddRun.stdout.toString()).toBe('ran [@x/b]\nran [two words *]\n');

    // A check no affected package has is a note and exit 0, never a failed job.
    const before = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'packages/b/x.ts': '1' } });

    const none = run({ check: 'compile', base: before });

    expect(none.exitCode).toBe(0);
    expect(none.stdout.toString()).toContain('no affected package has compile');
  });
});

describe('ci in the config', () => {
  const parse = (value: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ ci: value });

  test('nothing added by default', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).ci).toEqual({ affected: { global: [] } });
  });

  test('root-relative globs are accepted; absolute, .., empty and unknown keys are refused', () => {
    expect(parse({ affected: { global: ['Makefile', 'make/**'] } }).success).toBe(true);
    expect(parse({ affected: { global: ['/etc/x'] } }).success).toBe(false);
    expect(parse({ affected: { global: ['../x'] } }).success).toBe(false);
    expect(parse({ affected: { global: ['a/../b'] } }).success).toBe(false);
    expect(parse({ affected: { global: [''] } }).success).toBe(false);
    expect(parse({ affected: { global: 'Makefile' } }).success).toBe(false);
    expect(parse({ affected: { local: [] } }).success).toBe(false);
    expect(parse({ changed: {} }).success).toBe(false);
  });

  test('the manifest carries the block only when globs are added', () => {
    const manifestOf = (ciConfig: unknown) =>
      JSON.parse(
        ProjectManifest.render({
          root: createProject({ files: {} }),
          config: VULCAN_CONFIG_SCHEMA.parse({ ci: ciConfig }),
        }),
      );

    expect(manifestOf(undefined).ci).toBeUndefined();
    expect(manifestOf({ affected: { global: [] } }).ci).toBeUndefined();
    expect(manifestOf({ affected: { global: ['Makefile'] } }).ci).toEqual({
      affected: { global: ['Makefile'] },
    });
  });
});

describe('the command stays light', () => {
  const transpiler = new Bun.Transpiler({ loader: 'ts' });

  test('the ci command reaches no atlas, no zod and no config', () => {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [join(SRC, 'commands', 'ci.command.ts')];

    while (queue.length > 0) {
      const file = queue.pop() ?? '';

      if (files.has(file)) {
        continue;
      }

      files.add(file);

      for (const found of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        if (found.kind !== 'import-statement') {
          continue;
        }

        if (found.path.startsWith('.')) {
          queue.push(join(dirname(file), found.path));
        } else {
          packages.add(found.path);
        }
      }
    }

    expect(packages.has('@venizia/vulcan-atlas')).toBe(false);
    expect(packages.has('zod')).toBe(false);
    expect([...files].some((file) => file.includes('/config/'))).toBe(false);
  });
});
