import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CiAffected, CiGlobal, CiGraph, CiWorkspace } from '../../ci/index.ts';
import { git } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { ALL_SCRIPTS, commit, json, workspaceRepo } from './workspace.helper.ts';

afterAll(removeProjects);

const affectedNames = (opts: { root: string; base: string }): string[] => {
  const run = CiAffected.run({ root: opts.root, base: opts.base, head: 'HEAD' });

  if (!run.ok) {
    throw new Error(run.error);
  }

  return run.result.packages.map((entry) => `${entry.name}:${entry.reason}`);
};

/** a <- b <- c (c depends on b, b on a), d alone. */
const chain = (
  opts: { root?: Record<string, unknown>; files?: Record<string, string> } = {},
): string =>
  workspaceRepo({
    packages: {
      a: { name: '@x/a' },
      b: { name: '@x/b', dependencies: { '@x/a': 'workspace:*' } },
      c: { name: '@x/c', devDependencies: { '@x/b': 'workspace:^' } },
      d: { name: '@x/d' },
    },
    ...opts,
  });

describe('CiWorkspace.read', () => {
  test('an array of globs, the object form, a ! glob, nested folders; node_modules and nameless folders are skipped', () => {
    const root = createProject({
      files: {
        'package.json': json({
          value: {
            workspaces: { packages: ['packages/*', 'apps/**', '!packages/old'], catalog: {} },
          },
        }),
        'packages/one/package.json': json({ value: { name: 'one' } }),
        'packages/old/package.json': json({ value: { name: 'old' } }),
        'packages/nameless/package.json': json({ value: { version: '1' } }),
        'packages/one/node_modules/dep/package.json': json({ value: { name: 'dep' } }),
        'apps/web/deep/package.json': json({ value: { name: 'web' } }),
        'docs/package.json': json({ value: { name: 'docs' } }),
      },
    });
    const read = CiWorkspace.read({ root });

    expect(read.ok && read.packages.map((entry) => `${entry.name}@${entry.dir}`)).toEqual([
      'web@apps/web/deep',
      'one@packages/one',
    ]);
  });

  test('a ! glob with /** leaves out the folder itself and what is under it; one with /* keeps the folder', () => {
    const root = createProject({
      files: {
        'package.json': json({
          value: { workspaces: ['apps/**', 'packages/*', '!apps/old/**', '!packages/keep/*'] },
        }),
        'apps/old/package.json': json({ value: { name: 'old' } }),
        'apps/old/inner/package.json': json({ value: { name: 'old-inner' } }),
        'apps/new/package.json': json({ value: { name: 'new' } }),
        'packages/keep/package.json': json({ value: { name: 'keep' } }),
        'packages/keep/sub/package.json': json({ value: { name: 'keep-sub' } }),
      },
    });
    const read = CiWorkspace.read({ root });

    expect(read.ok && read.packages.map((entry) => entry.name)).toEqual(['new', 'keep']);
  });

  test('no package.json, one that is not JSON and one without workspaces are reasons, not crashes', () => {
    expect(CiWorkspace.read({ root: createProject({ files: {} }) })).toMatchObject({ ok: false });
    expect(
      CiWorkspace.read({ root: createProject({ files: { 'package.json': '{ nope' } }) }),
    ).toMatchObject({ ok: false });

    const none = CiWorkspace.read({ root: createProject({ files: { 'package.json': '{}' } }) });

    expect(none).toMatchObject({ ok: false });
    expect(JSON.stringify(none)).toContain('lists no workspaces');
  });

  test('every dependency field is read, and the scripts', () => {
    const root = createProject({
      files: {
        'package.json': json({ value: { workspaces: ['p/*'] } }),
        'p/x/package.json': json({
          value: {
            name: 'x',
            scripts: { test: 'bun test', note: 1 },
            dependencies: { a: '1' },
            devDependencies: { b: 'workspace:*' },
            peerDependencies: { c: '^1' },
            optionalDependencies: { d: 'catalog:' },
          },
        }),
      },
    });
    const read = CiWorkspace.read({ root });

    expect(read.ok && read.packages[0].dependencies.map((entry) => entry.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(read.ok && read.packages[0].scripts).toEqual({ test: 'bun test' });
  });
});

describe('CiGraph.closure', () => {
  const pkg = (name: string, ...needs: string[]) => ({
    name,
    dir: name,
    scripts: {},
    dependencies: needs.map((need) => ({ name: need, spec: 'workspace:*' })),
  });

  test('a diamond, a cycle and a self-dependency end, with the seed keeping its reason', () => {
    const packages = [
      pkg('base'),
      pkg('left', 'base'),
      pkg('right', 'base'),
      pkg('top', 'left', 'right'),
      pkg('loop-a', 'loop-b'),
      pkg('loop-b', 'loop-a'),
      pkg('self', 'self'),
    ];
    const diamond = CiGraph.closure({ packages, seeds: new Map([['base', 'changed']]) });

    expect([...diamond].sort()).toEqual([
      ['base', 'changed'],
      ['left', 'dependent'],
      ['right', 'dependent'],
      ['top', 'dependent'],
    ]);

    const cycle = CiGraph.closure({ packages, seeds: new Map([['loop-a', 'changed']]) });

    expect([...cycle].sort()).toEqual([
      ['loop-a', 'changed'],
      ['loop-b', 'dependent'],
    ]);
    expect([...CiGraph.closure({ packages, seeds: new Map([['self', 'changed']]) })]).toEqual([
      ['self', 'changed'],
    ]);
  });

  test('a dependency on a name outside the workspace is no edge', () => {
    const packages = [pkg('a', 'zod'), pkg('zod')];

    expect([
      ...CiGraph.closure({ packages: [packages[0]], seeds: new Map([['a', 'changed']]) }),
    ]).toEqual([['a', 'changed']]);
  });
});

describe('CiAffected.run: files', () => {
  test('a change in one package lists it and what depends on it, through dependencies and devDependencies', () => {
    const root = chain();
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'packages/a/src/index.ts': 'export const a = 2;\n' } });

    expect(affectedNames({ root, base })).toEqual([
      '@x/a:changed',
      '@x/b:dependent',
      '@x/c:dependent',
    ]);
  });

  test('a change at the end of the chain lists only that package; an unrelated package is never listed', () => {
    const root = chain();
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'packages/c/src/index.ts': 'export const c = 2;\n' } });

    expect(affectedNames({ root, base })).toEqual(['@x/c:changed']);
  });

  test('files outside any package, such as docs and the root README, affect nothing', () => {
    const root = chain();
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'README.md': 'hi\n', 'docs/guide.md': 'x\n' } });

    expect(affectedNames({ root, base })).toEqual([]);
  });

  test('a rename between packages lists both, and a deleted file still counts', () => {
    const root = chain();
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    git({ cwd: root, args: ['mv', 'packages/d/src/index.ts', 'packages/a/src/moved.ts'] });
    git({ cwd: root, args: ['commit', '--quiet', '-m', 'move'] });

    expect(affectedNames({ root, base })).toEqual([
      '@x/a:changed',
      '@x/b:dependent',
      '@x/c:dependent',
      '@x/d:changed',
    ]);

    const second = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'packages/a/src/moved.ts': null } });

    expect(affectedNames({ root, base: second })).toEqual([
      '@x/a:changed',
      '@x/b:dependent',
      '@x/c:dependent',
    ]);
  });

  test('the compare is with the merge base: what landed on the base after the branch left is not counted', () => {
    const root = chain();

    git({ cwd: root, args: ['checkout', '--quiet', '-b', 'feature/F-1-x'] });
    commit({ root, files: { 'packages/d/src/index.ts': 'export const d = 2;\n' } });
    git({ cwd: root, args: ['checkout', '--quiet', 'develop'] });
    commit({ root, files: { 'packages/a/src/index.ts': 'export const a = 3;\n' } });
    git({ cwd: root, args: ['checkout', '--quiet', 'feature/F-1-x'] });

    expect(affectedNames({ root, base: 'develop' })).toEqual(['@x/d:changed']);
  });

  test('a dependency by a version range, or by catalog:, on a workspace package is a link too', () => {
    const root = workspaceRepo({
      packages: {
        a: { name: '@x/a' },
        b: { name: '@x/b', dependencies: { '@x/a': '^1.0.0' } },
        c: { name: '@x/c', dependencies: { '@x/a': 'catalog:' } },
      },
    });
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'packages/a/src/index.ts': 'export const a = 2;\n' } });

    expect(affectedNames({ root, base })).toEqual([
      '@x/a:changed',
      '@x/b:dependent',
      '@x/c:dependent',
    ]);
  });

  test('the checks of a package are the standard scripts it defines, named as the script', () => {
    const root = workspaceRepo({
      packages: {
        a: { name: '@x/a', scripts: ALL_SCRIPTS },
        b: { name: '@x/b', scripts: { test: 'bun test', build: 'tsc', dev: 'x' } },
        c: { name: '@x/c', scripts: {} },
      },
    });
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({
      root,
      files: { 'packages/a/x.ts': '1', 'packages/b/x.ts': '1', 'packages/c/x.ts': '1' },
    });

    const run = CiAffected.run({ root, base, head: 'HEAD' });
    const checks = run.ok
      ? Object.fromEntries(run.result.packages.map((entry) => [entry.name, entry.checks]))
      : {};

    expect(checks).toEqual({
      '@x/a': { typecheck: 'typecheck', lint: 'lint', test: 'test', compile: 'compile' },
      '@x/b': { test: 'test' },
      '@x/c': {},
    });
  });
});

describe('CiAffected.run: global files', () => {
  const FILES = [
    'bun.lock',
    'bun.lockb',
    'package.json',
    'bunfig.toml',
    'tsconfig.json',
    'tsconfig.base.json',
    '.configs/lints/oxlint.config.mts',
    '.github/workflows/ci.yml',
    '.gitlab-ci.yml',
    '.gitlab/ci/test.yml',
  ];

  for (const file of FILES) {
    test(`${file} marks every package`, () => {
      const root = chain();
      const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

      // The root package.json must still be a workspace manifest.
      const text =
        file === 'package.json'
          ? json({
              value: {
                name: 'root',
                private: true,
                workspaces: ['packages/*'],
                scripts: { dev: 'x' },
              },
            })
          : 'x\n';

      commit({ root, files: { [file]: text } });

      const run = CiAffected.run({ root, base, head: 'HEAD' });

      expect(run.ok && run.result.all).toBe(true);
      expect(run.ok && run.result.allBecause).toBe(file);
      expect(run.ok && run.result.packages.map((entry) => entry.reason)).toEqual([
        'global',
        'global',
        'global',
        'global',
      ]);
    });
  }

  test('a file with the same name inside a package is that package only', () => {
    const root = chain();
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({
      root,
      files: {
        'packages/d/bun.lock': 'x',
        'packages/d/tsconfig.json': '{}',
        'packages/d/.configs/x': 'x',
      },
    });

    expect(affectedNames({ root, base })).toEqual(['@x/d:changed']);
  });

  test('the project adds globs through the manifest; nothing it adds removes a shipped one', () => {
    const manifest = json({ value: { ci: { affected: { global: ['Makefile', 'make/**'] } } } });
    const root = chain({ files: { '.agents/vulcan.manifest.json': manifest } });
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    expect(CiGlobal.read({ root })).toEqual(
      expect.arrayContaining(['bun.lock', 'Makefile', 'make/**']),
    );

    commit({ root, files: { 'make/lint.mk': 'x\n' } });

    const run = CiAffected.run({ root, base, head: 'HEAD' });

    expect(run.ok && run.result.allBecause).toBe('make/lint.mk');
    expect(run.ok && run.result.all).toBe(true);
  });
});

describe('CiAffected.run: the root package.json', () => {
  const repo = () =>
    workspaceRepo({
      root: { workspaces: { packages: ['packages/*'], catalog: { zod: '^4.0.0' } } },
      packages: {
        a: { name: '@x/a', dependencies: { zod: 'catalog:' } },
        b: { name: '@x/b', dependencies: { '@x/a': 'workspace:*' } },
        c: { name: '@x/c' },
      },
    });

  test('any change to it marks every package: a catalog bump, a script, a dependency, the workspaces globs, formatting', () => {
    const manifests: Record<string, Record<string, unknown>> = {
      catalog: { workspaces: { packages: ['packages/*'], catalog: { zod: '^4.1.0' } } },
      script: {
        workspaces: { packages: ['packages/*'], catalog: { zod: '^4.0.0' } },
        scripts: { dev: 'x' },
      },
      dependency: {
        workspaces: { packages: ['packages/*'], catalog: { zod: '^4.0.0' } },
        devDependencies: { oxlint: '1' },
      },
      globs: { workspaces: { packages: ['packages/*', 'apps/*'], catalog: { zod: '^4.0.0' } } },
      reordered: { workspaces: { catalog: { zod: '^4.0.0' }, packages: ['packages/*'] } },
    };

    for (const [name, manifest] of Object.entries(manifests)) {
      const r = repo();
      const base = git({ cwd: r, args: ['rev-parse', 'HEAD'] });

      commit({
        root: r,
        files: { 'package.json': json({ value: { name: 'root', private: true, ...manifest } }) },
      });

      const run = CiAffected.run({ root: r, base, head: 'HEAD' });

      expect(run.ok && run.result.all, name).toBe(true);
      expect(run.ok && run.result.allBecause, name).toBe('package.json');
      expect(run.ok && run.result.packages.map((entry) => entry.reason), name).toEqual([
        'global',
        'global',
        'global',
      ]);
    }
  });

  test('a package.json inside a package is that package only', () => {
    const r = repo();
    const base = git({ cwd: r, args: ['rev-parse', 'HEAD'] });

    commit({
      root: r,
      files: {
        'packages/c/package.json': json({
          value: { name: '@x/c', version: '2.0.0', scripts: ALL_SCRIPTS },
        }),
      },
    });

    expect(affectedNames({ root: r, base })).toEqual(['@x/c:changed']);
  });
});

describe('CiAffected.run: bases and heads', () => {
  test('a base of zeros, as a new branch passes, is every package, without asking git', () => {
    const root = workspaceRepo({ packages: { a: { name: '@x/a' }, b: { name: '@x/b' } } });
    const run = CiAffected.run({ root, base: '0'.repeat(40), head: 'HEAD' });

    expect(run.ok && run.result.all).toBe(true);
    expect(run.ok && run.result.allBecause).toContain('the base is empty');
    expect(run.ok && run.result.packages).toHaveLength(2);
  });

  test('a ref git does not know is an error that names it and says how to fetch more', () => {
    const root = workspaceRepo({ packages: { a: { name: '@x/a' } } });
    const run = CiAffected.run({ root, base: 'nope', head: 'HEAD' });

    expect(run).toMatchObject({ ok: false });
    expect(JSON.stringify(run)).toContain('nope is not a commit here');
    expect(JSON.stringify(run)).toContain('fetch-depth 0');
  });

  test('a head that is not the checked-out commit is refused', () => {
    const root = workspaceRepo({ packages: { a: { name: '@x/a' } } });
    const first = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    commit({ root, files: { 'packages/a/x.ts': '1' } });

    const run = CiAffected.run({ root, base: first, head: first });

    expect(JSON.stringify(run)).toContain('is not the checked-out commit');
  });

  test('a shallow clone that has not got the base says so', () => {
    const origin = workspaceRepo({ packages: { a: { name: '@x/a' } } });
    const first = git({ cwd: origin, args: ['rev-parse', 'HEAD'] });

    commit({ root: origin, files: { 'packages/a/x.ts': '1' } });
    commit({ root: origin, files: { 'packages/a/y.ts': '1' } });

    const clones = createProject({ files: {} });
    const clone = join(clones, 'shallow');

    mkdirSync(clones, { recursive: true });
    git({ cwd: clones, args: ['clone', '--quiet', '--depth', '1', `file://${origin}`, clone] });

    const run = CiAffected.run({ root: clone, base: first, head: 'HEAD' });

    expect(run).toMatchObject({ ok: false });
    expect(JSON.stringify(run)).toContain('fetch-depth 0');
  });

  test('the head defaults to what is checked out, by a ref or by its hash', () => {
    const root = chain();
    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });
    const head = commit({ root, files: { 'packages/d/x.ts': '1' } });

    expect(CiAffected.run({ root, base, head: head })).toMatchObject({ ok: true });
    expect(CiAffected.run({ root, base, head: 'develop' })).toMatchObject({ ok: true });
  });
});
