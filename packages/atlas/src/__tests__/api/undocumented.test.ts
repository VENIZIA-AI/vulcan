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
const sourceProject = (opts: { source: string }): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-undocumented-'));

  roots.push(root);

  const files: Record<string, string> = {
    '.agents/vulcan.manifest.json': JSON.stringify({
      schemaVersion: 1,
      name: 'acme',
      packages: [{ name: '@x/src', dir: 'src', path: 'packages/src', aliases: [], retired: false }],
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

  test('gen still needs built declarations: a source-only package has none', () => {
    const root = sourceProject({ source: '/** One. */\nexport const a = 1;\n' });
    const result = run({ root, args: ['gen'] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('no exports found');
  });
});
