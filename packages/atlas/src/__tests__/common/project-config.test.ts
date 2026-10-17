import { afterEach, describe, expect, test } from 'bun:test';
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
      config: {
        packages: [{ dir: 'kernel', name: '@a/kernel', aliases: ['k'], retired: false }],
        knowledge: { bundle: '.agents/knowledge', changelogs: 'docs/changelogs' },
        atlas: { tagPattern: 'v<version>', typescriptFrom: 'packages/kernel' },
      },
    });
    const project = readAtlasProject();

    expect(project.root).toBe(ROOT);
    expect(project.packages).toEqual([
      { dir: 'kernel', name: '@a/kernel', aliases: ['k'], retired: false },
    ]);
    expect(project.tagPattern).toBe('v<version>');
    expect(project.typescriptFrom).toBe(join(ROOT, 'packages/kernel'));
    expect(project.knowledge).toEqual({
      bundle: join(ROOT, '.agents/knowledge'),
      changelogs: join(ROOT, 'docs/changelogs'),
    });
    expect(
      project.releaseCommit.exec('[#80] chore(kernel): release v0.2.1-0 [prerelease]')?.groups,
    ).toMatchObject({ dir: 'kernel', version: '0.2.1-0' });
  });

  test('absent sections take the defaults: IGNIS-form release commit, the root for typescript', () => {
    useAtlasProject({ root: ROOT, config: {} });
    const project = readAtlasProject();

    expect(project.tagPattern).toBe('<dir>-v<version>');
    expect(project.typescriptFrom).toBe(ROOT);
    expect(project.releaseCommit.test('chore(boot): release v1.0.0 [patch]')).toBe(true);
  });

  test('outside vulcan x it stops with what to do', () => {
    expect(() => readAtlasProject()).toThrow(
      'atlas: no project config - run through `vulcan x atlas`',
    );
  });
});

describe('live and known packages', () => {
  test('a retired package keeps its changelog entries but is not walked by surface', () => {
    useAtlasProject({
      root: ROOT,
      config: {
        packages: [
          { dir: 'kernel', name: '@a/kernel', aliases: [], retired: false },
          { dir: 'docs-mcp', name: '@venizia/ignis-docs-mcp', aliases: [], retired: true },
        ],
      },
    });
    const project = readAtlasProject();

    expect(livePackageDirs({ project })).toEqual(['kernel']);
    expect(knownPackageDirs({ project })).toEqual(['kernel', 'docs-mcp']);
  });

  test('no live package: surface and symbols have nothing to walk and say what to add', () => {
    useAtlasProject({ root: ROOT, config: {} });

    expect(() => livePackageDirs({ project: readAtlasProject() })).toThrow(
      'atlas: add packages to .configs/vulcan.config.ts',
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
