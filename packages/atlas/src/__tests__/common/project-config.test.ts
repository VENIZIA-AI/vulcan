import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { PackageMap } from '@/common/package-map';
import { clearAtlasProject, useAtlasProject } from '../project.helper';

const roots: string[] = [];

afterEach(clearAtlasProject);
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ROOT = '/work/project';

describe('ProjectConfig.manifestFileOf', () => {
  const folder = (files: string[]): string => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-manifest-'));

    roots.push(root);
    mkdirSync(join(root, '.agents'), { recursive: true });

    for (const file of files) {
      writeFileSync(join(root, '.agents', file), '{}');
    }

    return root;
  };

  test('the descriptor first, then the manifest of an older release, then nothing', () => {
    expect(
      ProjectConfig.manifestFileOf({
        dir: folder(['atlas.manifest.json', 'vulcan.manifest.json']),
      }),
    ).toEndWith('.agents/atlas.manifest.json');
    expect(ProjectConfig.manifestFileOf({ dir: folder(['vulcan.manifest.json']) })).toEndWith(
      '.agents/vulcan.manifest.json',
    );
    expect(ProjectConfig.manifestFileOf({ dir: folder([]) })).toBeUndefined();
  });
});

describe('ProjectConfig.readAtlasProject', () => {
  test('reads the packages, compiles the release commit, resolves the paths', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        packages: [
          {
            name: '@a/kernel',
            dir: 'kernel',
            path: 'backends/kernel',
            aliases: ['k'],
            retired: false,
          },
        ],
        knowledge: { bundle: '.agents/knowledge', changelogs: 'docs/changelogs' },
        release: { tagPattern: 'v<version>', ignoreTags: ['old/*'] },
      },
    });
    const project = ProjectConfig.readAtlasProject();

    expect(project.root).toBe(ROOT);
    expect(project.packages).toEqual([
      { dir: 'kernel', name: '@a/kernel', path: 'backends/kernel', aliases: ['k'], retired: false },
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
    const project = ProjectConfig.readAtlasProject();

    expect(project.tagPattern).toBe('<dir>-v<version>');
    expect(project.ignoreTags).toEqual([]);
    expect(project.typescriptFrom).toBe(ROOT);
  });

  test('without vulcan x it reads the committed manifest at the project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-manifest-'));

    roots.push(root);
    mkdirSync(join(root, '.agents'));
    writeFileSync(
      join(root, '.agents/vulcan.manifest.json'),
      JSON.stringify({ schemaVersion: 1, packages: [{ name: '@a/core', dir: 'core' }] }),
    );
    process.env.VULCAN_PROJECT_ROOT = root;

    expect(ProjectConfig.readAtlasProject().packages.map((entry) => entry.name)).toEqual([
      '@a/core',
    ]);
  });

  test('no manifest: it stops with what to do', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-no-manifest-'));

    roots.push(root);
    process.env.VULCAN_PROJECT_ROOT = root;

    expect(() => ProjectConfig.readAtlasProject()).toThrow(
      'atlas: no project manifest (.agents/atlas.manifest.json) - run `vulcan sync`',
    );
  });

  test('a package name that is not an npm name stops the read, naming the project and the name', () => {
    useAtlasProject({
      root: ROOT,
      manifest: { name: 'acme', packages: [{ name: '../../../escape', dir: 'kernel' }] },
    });

    expect(() => ProjectConfig.readAtlasProject()).toThrow(
      "atlas: project 'acme' - package name '../../../escape' is not an npm package name",
    );
  });

  test.each(['2026-11-1', 'soon', '2026-11-14T00:00'])(
    'a datedUntil that is not a plain day (%s) stops the read, naming the project and the value',
    (value) => {
      useAtlasProject({
        root: ROOT,
        manifest: { name: 'acme', knowledge: { datedUntil: value }, packages: [] },
      });

      expect(() => ProjectConfig.readAtlasProject()).toThrow(
        `atlas: project 'acme' - knowledge.datedUntil '${value}' is not a date (YYYY-MM-DD)`,
      );
    },
  );

  test('a plain day in datedUntil is read', () => {
    useAtlasProject({
      root: ROOT,
      manifest: { name: 'acme', knowledge: { datedUntil: '2026-11-14' }, packages: [] },
    });

    expect(ProjectConfig.readAtlasProject().knowledge.datedUntil).toBe('2026-11-14');
  });

  test('a siteUrl is read without its trailing slash', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        name: 'acme',
        knowledge: { siteUrl: 'https://acme.example.test/wiki/' },
        packages: [],
      },
    });

    expect(ProjectConfig.readAtlasProject().knowledge.siteUrl).toBe(
      'https://acme.example.test/wiki',
    );
  });

  test.each([
    'acme.example.test',
    'ftp://acme.example.test',
    'https://user:pw@acme.example.test',
    'https://acme.example.test/a b',
    'javascript:alert(1)',
  ])('a siteUrl that is not a usable address (%s) stops the read, naming the project', (value) => {
    useAtlasProject({
      root: ROOT,
      manifest: { name: 'acme', knowledge: { siteUrl: value }, packages: [] },
    });

    expect(() => ProjectConfig.readAtlasProject()).toThrow(
      "atlas: project 'acme' - knowledge.siteUrl ",
    );
  });

  test('a siteUrl with an escape sequence is refused and never echoed raw', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        name: 'acme',
        knowledge: { siteUrl: 'https://acme.example.test/\u001b[2J\u202e' },
        packages: [],
      },
    });

    let message = '';

    try {
      ProjectConfig.readAtlasProject();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('knowledge.siteUrl');
    expect(message).toContain('\\u001b');
    expect(message).not.toContain('\u001b');
    expect(message).not.toContain('\u202e');
  });

  test('a package without a name takes its directory, which must be an npm name too', () => {
    useAtlasProject({ root: ROOT, manifest: { name: 'acme', packages: [{ dir: 'a b' }] } });

    expect(() => ProjectConfig.readAtlasProject()).toThrow(
      "atlas: project 'acme' - package name 'a b' is not an npm package name",
    );
  });

  test('scoped and unscoped lower-case npm names read', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        packages: [
          { name: '@venizia/ignis-kernel', dir: 'kernel' },
          { name: 'left-pad.js', dir: 'pad' },
        ],
      },
    });

    expect(ProjectConfig.readAtlasProject().packages.map((entry) => entry.name)).toEqual([
      '@venizia/ignis-kernel',
      'left-pad.js',
    ]);
  });

  test.each(['JSONStream', '@Venizia/kernel'])(
    'an upper-case npm name (%s) stops the read like any name that is not one',
    (name) => {
      useAtlasProject({
        root: ROOT,
        manifest: { name: 'acme', packages: [{ name, dir: 'kernel' }] },
      });

      expect(() => ProjectConfig.readAtlasProject()).toThrow(
        `atlas: project 'acme' - package name '${name}' is not an npm package name`,
      );
    },
  );

  test('a manifest from a newer VULCAN fails loudly, naming the upgrade', () => {
    useAtlasProject({ root: ROOT, manifest: { schemaVersion: 2 } });

    expect(() => ProjectConfig.readAtlasProject()).toThrow(
      'atlas: the manifest is schemaVersion 2; @venizia/vulcan-atlas reads 1 - upgrade @venizia/vulcan',
    );
  });
});

describe('live and known packages', () => {
  test('a retired package is not walked by surface', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        packages: [
          { name: '@a/kernel', dir: 'kernel', aliases: [], retired: false },
          { name: '@a/docs-mcp', dir: 'docs-mcp', aliases: [], retired: true },
        ],
      },
    });
    const project = ProjectConfig.readAtlasProject();

    expect(ProjectConfig.livePackageDirs({ project })).toEqual(['kernel']);
  });

  test('no live package: surface and symbols have nothing to walk and say what to add', () => {
    useAtlasProject({ root: ROOT, manifest: {} });

    expect(() =>
      ProjectConfig.livePackageDirs({ project: ProjectConfig.readAtlasProject() }),
    ).toThrow('atlas: add packages to .configs/vulcan.config.*');
  });
});

describe('the prebuilt index in a manifest', () => {
  const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  const manifest = (atlas?: unknown) => ({
    packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
    knowledge: { bundle: '.agents/knowledge' },
    release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    ...(atlas === undefined ? {} : { atlas }),
  });

  test('the listed keys and the switch are read; text that is not a key is dropped', () => {
    useAtlasProject({
      root: ROOT,
      manifest: manifest({ index: { keys: [KEY, 7, ''] }, prebuilt: false }),
    });

    const project = ProjectConfig.readAtlasProject();

    expect(project.indexKeys).toEqual([KEY]);
    expect(project.prebuilt).toBe(false);
  });

  test('a manifest with no atlas block has neither', () => {
    useAtlasProject({ root: ROOT, manifest: manifest() });

    const project = ProjectConfig.readAtlasProject();

    expect(project.indexKeys).toBeUndefined();
    expect(project.prebuilt).toBeUndefined();
  });

  test('prebuilt true, or anything but false, is the default', () => {
    useAtlasProject({ root: ROOT, manifest: manifest({ prebuilt: true }) });
    expect(ProjectConfig.readAtlasProject().prebuilt).toBeUndefined();
    useAtlasProject({ root: ROOT, manifest: manifest({ prebuilt: 'no' }) });
    expect(ProjectConfig.readAtlasProject().prebuilt).toBeUndefined();
  });
});

describe('PackageMap.directoryOf', () => {
  const packages = [
    { dir: 'core-server', name: '@venizia/ignis', aliases: ['core'], retired: false },
    { dir: 'helpers', name: '@venizia/ignis-helpers', aliases: [], retired: false },
  ];

  test('a value resolves by npm name, by name without its scope, by directory, or by alias', () => {
    expect(PackageMap.directoryOf({ value: '`@venizia/ignis`', packages })).toBe('core-server');
    expect(PackageMap.directoryOf({ value: 'ignis-helpers', packages })).toBe('helpers');
    expect(PackageMap.directoryOf({ value: 'core', packages })).toBe('core-server');
    expect(PackageMap.directoryOf({ value: 'core-server', packages })).toBe('core-server');
    expect(PackageMap.directoryOf({ value: 'unknown', packages })).toBeUndefined();
  });
});

describe('release.legacyTagPatterns', () => {
  test('a manifest that lists legacy templates gives them in order; non-strings are dropped', () => {
    useAtlasProject({
      root: ROOT,
      manifest: {
        schemaVersion: 1,
        release: {
          tagPattern: 'vulcan-v<version>',
          legacyTagPatterns: ['v<version>', 7, 'old-<version>'],
        },
      },
    });

    expect(ProjectConfig.readAtlasProject().legacyTagPatterns).toEqual([
      'v<version>',
      'old-<version>',
    ]);
  });

  test('an older manifest, or an empty list, has none', () => {
    useAtlasProject({
      root: ROOT,
      manifest: { schemaVersion: 1, release: { tagPattern: 'v<version>' } },
    });

    expect(ProjectConfig.readAtlasProject().legacyTagPatterns).toBeUndefined();

    useAtlasProject({
      root: ROOT,
      manifest: { schemaVersion: 1, release: { tagPattern: 'v<version>', legacyTagPatterns: [] } },
    });

    expect(ProjectConfig.readAtlasProject().legacyTagPatterns).toBeUndefined();
  });
});
