import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const ROOT = join(import.meta.dir, '..', '..', '..');
// VULCAN's packages are libraries: they keep Makefile targets, and their package.json scripts carry
// none of the names the app standard retired.
const LIBRARY_TARGETS = ['build', 'typecheck', 'lint', 'lint-fix', 'test', 'clean'];
const LEGACY_SCRIPTS = ['dev', 'start', 'build', 'rebuild', 'preview', 'server:prod'];

describe('the root Makefile exposes the library target set', () => {
  for (const target of LIBRARY_TARGETS) {
    test(`make ${target}`, () => {
      const result = spawnSyncBounded({
        cmd: ['make', '-n', target],
        cwd: ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.stderr.toString()).not.toContain('No rule to make target');
      expect(result.exitCode).toBe(0);
    });
  }

  test('lint-fix applies the fixes and typecheck checks every package', () => {
    const lintFix = spawnSyncBounded({
      cmd: ['make', '-n', 'lint-fix'],
      cwd: ROOT,
      stdout: 'pipe',
    });
    const typecheck = spawnSyncBounded({
      cmd: ['make', '-n', 'typecheck'],
      cwd: ROOT,
      stdout: 'pipe',
    });

    expect(lintFix.stdout.toString()).toContain('--fix');
    expect(typecheck.stdout.toString()).toContain('typecheck');
  });

  const dryRun = (opts: { cwd: string; target: string }) =>
    spawnSyncBounded({
      cmd: ['make', '-n', opts.target],
      cwd: opts.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test('the recipe lives in lint-fix: the root lint-fix runs every package and the root files', () => {
    const plan = dryRun({ cwd: ROOT, target: 'lint-fix' }).stdout.toString();

    for (const dir of readdirSync(join(ROOT, 'packages'))) {
      expect(plan).toContain(`-C packages/${dir} lint-fix`);
    }

    expect(plan).toContain('bun fmt');
  });

  test('there is no fmt target at the root, in a package, or as a fmt-<pkg> rule', () => {
    const targets = [
      { cwd: ROOT, target: 'fmt' },
      { cwd: ROOT, target: 'fmt-packages' },
      { cwd: ROOT, target: 'fmt-okf' },
      { cwd: join(ROOT, 'packages', 'okf'), target: 'fmt' },
    ];

    for (const item of targets) {
      const result = dryRun(item);

      expect(result.exitCode, item.target).not.toBe(0);
      expect(result.stderr.toString()).toContain('No rule to make target');
    }
  });

  test('make help lists them', () => {
    const help = spawnSyncBounded({
      cmd: ['make', 'help'],
      cwd: ROOT,
      stdout: 'pipe',
    }).stdout.toString();

    for (const target of ['typecheck', 'lint-fix']) {
      expect(help).toContain(target);
    }
  });
});

describe('no package.json script carries a legacy name', () => {
  const manifests = [
    join(ROOT, 'package.json'),
    ...readdirSync(join(ROOT, 'packages')).map((dir) =>
      join(ROOT, 'packages', dir, 'package.json'),
    ),
  ];

  for (const file of manifests) {
    test(file.slice(ROOT.length + 1), () => {
      const scripts = Object.keys(JSON.parse(readFileSync(file, 'utf8')).scripts ?? {});

      expect(scripts.filter((name) => LEGACY_SCRIPTS.includes(name))).toEqual([]);
    });
  }

  test('atlas keeps prepublishOnly', () => {
    const scripts = JSON.parse(
      readFileSync(join(ROOT, 'packages', 'atlas', 'package.json'), 'utf8'),
    ).scripts;

    expect(scripts.prepublishOnly).toBe('make rebuild');
  });
});
