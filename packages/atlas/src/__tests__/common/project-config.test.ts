import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knownPackageDirs, livePackageDirs, readAtlasProject } from '@/common/project-config';
import { directoryOf } from '@/common/package-map';
import { clearAtlasProject, useAtlasProject } from '../project.helper';

afterEach(clearAtlasProject);

const ROOT = '/work/project';

describe('readAtlasProject', () => {
  test('reads the packages, compiles the release commit, resolves the paths', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        packages: [
          {
            name: '@a/kernel',
            dir: 'kernel',
            path: 'umbras/kernel',
            aliases: ['k'],
            retired: false,
          },
        ],
        knowledge: { bundle: '.agents/knowledge', changelogs: 'docs/changelogs' },
        release: { tagPattern: 'v<version>', legacyTagPrefixes: [], ignoreTags: ['old/*'] },
      },
    });
    const project = readAtlasProject();

    expect(project.root).toBe(ROOT);
    expect(project.packages).toEqual([
      { dir: 'kernel', name: '@a/kernel', path: 'umbras/kernel', aliases: ['k'], retired: false },
    ]);
    expect(project.tagPattern).toBe('v<version>');
    expect(project.ignoreTags).toEqual(['old/*']);
    expect(project.knowledge).toEqual({
      bundle: join(ROOT, '.agents/knowledge'),
      changelogs: join(ROOT, 'docs/changelogs'),
    });
  });

  test('absent sections take the defaults: the default release forms, the root for typescript', () => {
    useAtlasProject({ root: ROOT, manifest: {} });
    const project = readAtlasProject();

    expect(project.tagPattern).toBe('<dir>-v<version>');
    expect(project.ignoreTags).toEqual([]);
    expect(project.typescriptFrom).toBe(ROOT);
  });

  test('without vulcan x it reads the committed manifest at the project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-manifest-'));

    mkdirSync(join(root, '.agents'));
    writeFileSync(
      join(root, '.agents/vulcan.manifest.json'),
      JSON.stringify({ schemaVersion: 1, packages: [{ name: '@a/core', dir: 'core' }] }),
    );
    process.env.VULCAN_PROJECT_ROOT = root;

    expect(readAtlasProject().packages.map(entry => entry.name)).toEqual(['@a/core']);
    rmSync(root, { recursive: true, force: true });
  });

  test('no manifest: it stops with what to do', () => {
    process.env.VULCAN_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'atlas-no-manifest-'));

    expect(() => readAtlasProject()).toThrow(
      'atlas: no project manifest (.agents/vulcan.manifest.json) - run `vulcan sync`',
    );
  });

  test('a package name that is not an npm name stops the read, naming the project and the name', () => {
    useAtlasProject({
      root: ROOT,
      manifest: { name: 'acme', packages: [{ name: '../../../escape', dir: 'kernel' }] },
    });

    expect(() => readAtlasProject()).toThrow(
      "atlas: project 'acme' - package name '../../../escape' is not an npm package name",
    );
  });

  test('a package without a name takes its directory, which must be an npm name too', () => {
    useAtlasProject({ root: ROOT, manifest: { name: 'acme', packages: [{ dir: 'a b' }] } });

    expect(() => readAtlasProject()).toThrow(
      "atlas: project 'acme' - package name 'a b' is not an npm package name",
    );
  });

  test('scoped, unscoped and legacy upper-case npm names all read', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        packages: [
          { name: '@venizia/ignis-kernel', dir: 'kernel' },
          { name: 'left-pad.js', dir: 'pad' },
          { name: 'JSONStream', dir: 'stream' },
        ],
      },
    });

    expect(readAtlasProject().packages.map(entry => entry.name)).toEqual([
      '@venizia/ignis-kernel',
      'left-pad.js',
      'JSONStream',
    ]);
  });

  test('a manifest from a newer VULCAN fails loudly, naming the upgrade', () => {
    useAtlasProject({ root: ROOT, manifest: { schemaVersion: 2 } });

    expect(() => readAtlasProject()).toThrow(
      'atlas: the manifest is schemaVersion 2; @venizia/vulcan-atlas reads 1 - upgrade @venizia/vulcan',
    );
  });
});

describe('live and known packages', () => {
  test('a retired package keeps its changelog entries but is not walked by surface', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        packages: [
          { name: '@a/kernel', dir: 'kernel', aliases: [], retired: false },
          { name: '@a/docs-mcp', dir: 'docs-mcp', aliases: [], retired: true },
        ],
      },
    });
    const project = readAtlasProject();

    expect(livePackageDirs({ project })).toEqual(['kernel']);
    expect(knownPackageDirs({ project })).toEqual(['kernel', 'docs-mcp']);
  });

  test('no live package: surface and symbols have nothing to walk and say what to add', () => {
    useAtlasProject({ root: ROOT, manifest: {} });

    expect(() => livePackageDirs({ project: readAtlasProject() })).toThrow(
      'atlas: add packages to .configs/vulcan.config.*',
    );
  });
});

describe('directoryOf', () => {
  const packages = [
    { dir: 'core-server', name: '@venizia/ignis', aliases: ['core'], retired: false },
    { dir: 'helpers', name: '@venizia/ignis-helpers', aliases: [], retired: false },
  ];

  test('a value resolves by npm name, by name without its scope, by directory, or by alias', () => {
    expect(directoryOf({ value: '`@venizia/ignis`', packages })).toBe('core-server');
    expect(directoryOf({ value: 'ignis-helpers', packages })).toBe('helpers');
    expect(directoryOf({ value: 'core', packages })).toBe('core-server');
    expect(directoryOf({ value: 'core-server', packages })).toBe('core-server');
    expect(directoryOf({ value: 'unknown', packages })).toBeUndefined();
  });
});
