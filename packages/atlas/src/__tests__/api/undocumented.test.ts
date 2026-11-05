import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const CLI = join(__dirname, '..', '..', 'cli.ts');

/** A project whose one package publishes its TypeScript source, with the files that package holds. */
const sourceProject = (opts: { source: string; retired?: boolean }): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-undocumented-'));

  roots.push(root);

  const files: Record<string, string> = {
    '.agents/vulcan.manifest.json': JSON.stringify({
      schemaVersion: 1,
      name: 'acme',
      packages: [
        {
          name: '@x/src',
          dir: 'src',
          path: 'packages/src',
          aliases: [],
          retired: opts.retired === true,
        },
      ],
      knowledge: { bundle: 'docs/knowledge', wiki: 'docs/wiki' },
      release: { tagPattern: 'v<version>', ignoreTags: [] },
      rules: { project: '.agents/rules.md', base: {} },
    }),
    'packages/src/package.json': JSON.stringify({
      name: '@x/src',
      version: '1.0.0',
      exports: { '.': './src/index.ts' },
    }),
    'packages/src/src/index.ts': opts.source,
  };

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
};

const run = (opts: { root: string; args: string[] }) =>
  spawnSyncBounded({
    cmd: [process.execPath, CLI, 'api', ...opts.args],
    cwd: opts.root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

describe('vulcan x atlas api undocumented, on a package that publishes its source', () => {
  test('lists the exports without TSDoc and exits 1', () => {
    const root = sourceProject({
      source: '/** Documented. */\nexport const a = 1;\nexport function bare(): void {}\n',
    });
    const result = run({ root, args: ['undocumented'] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('@x/src: bare');
    expect(result.stderr.toString()).not.toContain('a,');
  });

  test('exits 0 when every export has TSDoc', () => {
    const root = sourceProject({ source: '/** One. */\nexport const a = 1;\n' });
    const result = run({ root, args: ['undocumented', '--package', 'src'] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('every export has TSDoc');
  });

  test.each([
    ['its dir', 'src'],
    ['its npm name', '@x/src'],
    ['its path', 'packages/src'],
    ['its path with a leading ./ and a trailing /', './packages/src/'],
  ])('--package takes %s', (_, value) => {
    const root = sourceProject({ source: 'export function bare(): void {}\n' });
    const result = run({ root, args: ['undocumented', '--package', value] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('@x/src: bare');
  });

  test('a value that matches no package says so, names it, and is not "build the packages first"', () => {
    const root = sourceProject({ source: 'export function bare(): void {}\n' });
    const result = run({
      root,
      args: ['undocumented', '--package', 'packages/nope', '--package', 'src'],
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      "--package 'packages/nope' matches no package of this project (use its dir, npm name or path)",
    );
    expect(result.stderr.toString()).not.toContain('build the packages first');
  });

  test('--package=<value> is read like --package <value>, and a flag with no value is named', () => {
    const root = sourceProject({ source: 'export function bare(): void {}\n' });
    const equals = run({ root, args: ['undocumented', '--package=packages/src'] });
    const unknown = run({ root, args: ['undocumented', '--package=nope'] });
    const empty = run({ root, args: ['undocumented', '--package'] });

    expect(equals.exitCode).toBe(1);
    expect(equals.stderr.toString()).toContain('@x/src: bare');
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr.toString()).toContain("--package 'nope' matches no package");
    expect(empty.exitCode).toBe(2);
    expect(empty.stderr.toString()).toContain('--package needs a value');
  });

  test('a bad value stops gen and check too, before any compile, and is named once', () => {
    const root = sourceProject({ source: 'export function bare(): void {}\n' });

    for (const command of ['gen', 'check']) {
      const result = run({ root, args: [command, '--package', 'nope', '--package', 'nope'] });

      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("--package 'nope' matches no package");
      expect(result.stderr.toString()).not.toContain("'nope', 'nope'");
    }
  });

  test('a retired package matches nothing', () => {
    const root = sourceProject({ source: 'export function bare(): void {}\n', retired: true });
    const result = run({ root, args: ['undocumented', '--package', 'src'] });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("--package 'src' matches no package");
  });

  test('a package that matches but has no records still says to build', () => {
    const root = sourceProject({ source: 'export function bare(): void {}\n' });
    const result = run({ root, args: ['gen', '--package', 'packages/src'] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('no exports found - build the packages first');
  });

  test('gen still needs built declarations: a source-only package has none', () => {
    const root = sourceProject({ source: '/** One. */\nexport const a = 1;\n' });
    const result = run({ root, args: ['gen'] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('no exports found');
  });
});
