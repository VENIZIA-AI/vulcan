import { ModeArguments, ModeUsageError } from '@/cli/index';
import { MANIFEST_FILE, ProjectConfig } from '@/common/project-config';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

const PACKAGE_MANIFEST = JSON.stringify({ name: '@venizia/vulcan-atlas' });

const tempDirectories: string[] = [];

const makeTempDirectory = (opts: { prefix: string }): string => {
  const directory = mkdtempSync(join(tmpdir(), opts.prefix));

  tempDirectories.push(directory);

  return directory;
};

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }

  tempDirectories.length = 0;
});

/** A scratch project: its manifest and its knowledge bundle. */
const makeRepositoryRoot = (): string => {
  const root = makeTempDirectory({ prefix: 'atlas-modes-repo-' });

  mkdirSync(join(root, '.agents/knowledge'), { recursive: true });
  writeFileSync(join(root, MANIFEST_FILE), JSON.stringify({ schemaVersion: 1, name: 'demo' }));

  return root;
};

/** A scratch package directory with a real `package.json` naming this package. */
const makePackageDirectory = (opts: { withSnapshot: boolean }): string => {
  const packageDirectory = makeTempDirectory({ prefix: 'atlas-modes-pkg-' });

  writeFileSync(join(packageDirectory, 'package.json'), PACKAGE_MANIFEST);

  if (opts.withSnapshot) {
    mkdirSync(join(packageDirectory, 'dist/corpus'), { recursive: true });
  }

  return packageDirectory;
};

describe('ModeArguments.readCacheDir', () => {
  test('both spellings give the value, and an absent flag gives none', () => {
    expect(ModeArguments.readCacheDir({ argv: ['mcp', '--cache-dir', '/data/atlas'] })).toBe(
      '/data/atlas',
    );
    expect(ModeArguments.readCacheDir({ argv: ['--cache-dir=build/atlas'] })).toBe('build/atlas');
    expect(ModeArguments.readCacheDir({ argv: ['mcp'] })).toBeUndefined();
  });

  test('an empty value, a following flag or no value is a usage error', () => {
    expect(() => ModeArguments.readCacheDir({ argv: ['--cache-dir='] })).toThrow(
      '--cache-dir requires a value',
    );
    expect(() => ModeArguments.readCacheDir({ argv: ['--cache-dir', '--verbose'] })).toThrow(
      '--cache-dir requires a value',
    );
    expect(() => ModeArguments.readCacheDir({ argv: ['mcp', '--cache-dir'] })).toThrow(
      '--cache-dir requires a value',
    );
  });
});

describe('ModeArguments.readRoot (M11)', () => {
  test('--root=<dir> is the same as --root <dir>; an empty value or a following flag is a usage error', () => {
    expect(ModeArguments.readRoot({ argv: ['--root=/srv/ignis'] })).toEqual({
      value: '/srv/ignis',
      explicit: true,
    });
    expect(() => ModeArguments.readRoot({ argv: ['--root='] })).toThrow('--root requires a value');
    expect(() => ModeArguments.readRoot({ argv: ['--root', '--verbose'] })).toThrow(
      '--root requires a value',
    );
  });

  test('no --root flag reads cwd and is not explicit', () => {
    expect(ModeArguments.readRoot({ argv: [] })).toEqual({ value: process.cwd(), explicit: false });
  });

  test('--root <dir> reads the given directory and is explicit', () => {
    expect(ModeArguments.readRoot({ argv: ['--root', '/some/dir'] })).toEqual({
      value: '/some/dir',
      explicit: true,
    });
  });

  test('--root with no value throws ModeUsageError instead of silently falling back to cwd', () => {
    expect(() => ModeArguments.readRoot({ argv: ['--root'] })).toThrow(ModeUsageError);
  });
});

describe('ModeArguments.findPackageDirectory', () => {
  test('finds the package directory from both a source-style and a dist-style start directory', () => {
    const packageDirectory = makePackageDirectory({ withSnapshot: false });
    const sourceStyleStart = join(packageDirectory, 'src');
    const distStyleStart = join(packageDirectory, 'dist/cjs');

    mkdirSync(sourceStyleStart, { recursive: true });
    mkdirSync(distStyleStart, { recursive: true });

    expect(ModeArguments.findPackageDirectory({ startDirectory: sourceStyleStart })).toBe(
      packageDirectory,
    );
    expect(ModeArguments.findPackageDirectory({ startDirectory: distStyleStart })).toBe(
      packageDirectory,
    );
  });

  test('finds the real packages/atlas directory from this test file location', () => {
    expect(ModeArguments.findPackageDirectory({ startDirectory: __dirname })).toBe(
      join(__dirname, '../../..'),
    );
  });

  test('throws when no ancestor package.json names this package', () => {
    const orphan = makeTempDirectory({ prefix: 'atlas-modes-orphan-' });

    expect(() => ModeArguments.findPackageDirectory({ startDirectory: orphan })).toThrow();
  });
});

describe('ModeArguments.readPackageVersion (I6)', () => {
  test('reads the version field from the located package.json', () => {
    const packageDirectory = makeTempDirectory({ prefix: 'atlas-modes-version-' });

    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: '@venizia/vulcan-atlas', version: '9.9.9-test' }),
    );

    expect(ModeArguments.readPackageVersion({ directory: packageDirectory })).toBe('9.9.9-test');
  });

  test('is undefined when the directory has no package.json', () => {
    const empty = makeTempDirectory({ prefix: 'atlas-modes-no-manifest-' });

    expect(ModeArguments.readPackageVersion({ directory: empty })).toBeUndefined();
  });

  test('reads the real packages/atlas version from this test file location', () => {
    const packageDirectory = ModeArguments.findPackageDirectory({ startDirectory: __dirname });

    expect(ModeArguments.readPackageVersion({ directory: packageDirectory })).toMatch(
      /^\d+\.\d+\.\d+/,
    );
  });
});

describe('ProjectConfig.hasAtlasProject - a project is a manifest, never a layout', () => {
  const previous = { manifest: process.env.VULCAN_MANIFEST, root: process.env.VULCAN_PROJECT_ROOT };

  afterEach(() => {
    process.env.VULCAN_MANIFEST = previous.manifest;
    process.env.VULCAN_PROJECT_ROOT = previous.root;

    if (previous.manifest === undefined) {
      delete process.env.VULCAN_MANIFEST;
    }

    if (previous.root === undefined) {
      delete process.env.VULCAN_PROJECT_ROOT;
    }
  });

  test('a directory laid out with docs and knowledge, but no manifest, is not a project', () => {
    const root = makeTempDirectory({ prefix: 'atlas-layout-only-' });

    mkdirSync(join(root, 'docs/wiki/content/changelogs'), { recursive: true });
    mkdirSync(join(root, '.agents/knowledge'), { recursive: true });

    expect(ProjectConfig.hasAtlasProject({ root })).toBe(false);
  });

  test('a directory with a manifest is a project, whatever its layout', () => {
    expect(ProjectConfig.hasAtlasProject({ root: makeRepositoryRoot() })).toBe(true);
  });

  test('the manifest vulcan x hands over counts for the root it named, and no other', () => {
    const named = makeTempDirectory({ prefix: 'atlas-handed-' });
    const other = makeTempDirectory({ prefix: 'atlas-other-' });

    process.env.VULCAN_MANIFEST = JSON.stringify({ schemaVersion: 1 });
    process.env.VULCAN_PROJECT_ROOT = named;

    expect(ProjectConfig.hasAtlasProject({ root: named })).toBe(true);
    expect(ProjectConfig.hasAtlasProject({ root: other })).toBe(false);
  });
});
