import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, initRepo } from '../git-repo.helper.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { ManifestConstants, ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const CONFIG_TEXT = `export default {
  name: 'acme',
  packs: ['venizia'],
  packages: [{ dir: 'kernel', name: '@x/kernel' }],
  events: { log: true },
  project: { key: 'ACME' },
  guard: { outside: 'deny' },
  atlas: { index: { keys: ['RO71nPFQIg09uea7CNjO1QwvEOtD85330LwiiD0cPSQ='] } },
};
`;
const project = (opts: { legacy?: string } = {}): string =>
  createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG_TEXT,
      'package.json': '{ "name": "@x/acme-workspace" }',
      '.gitignore': 'node_modules\n',
      ...(opts.legacy === undefined ? {} : { [ManifestConstants.LEGACY_FILE]: opts.legacy }),
    },
  });
const configOf = (root: string) => {
  const parsed = VULCAN_CONFIG_SCHEMA.parse({
    name: 'acme',
    packages: [{ dir: 'kernel', name: '@x/kernel' }],
    events: { log: true },
    project: { key: 'ACME' },
    guard: { outside: 'deny' },
    atlas: { index: { keys: ['RO71nPFQIg09uea7CNjO1QwvEOtD85330LwiiD0cPSQ='] } },
  });

  return { root, config: parsed };
};

describe('the descriptor and the local manifest', () => {
  test('the descriptor holds only what atlas and the wiki read, with the values and the order of the manifest', () => {
    const root = project();
    const whole = JSON.parse(ProjectManifest.render(configOf(root)));
    const descriptor = JSON.parse(ProjectManifest.renderDescriptor(configOf(root)));

    expect(Object.keys(descriptor)).toEqual(
      Object.keys(whole).filter((key) => ManifestConstants.DESCRIPTOR_KEYS.includes(key)),
    );
    for (const key of Object.keys(descriptor)) {
      expect(descriptor[key], key).toEqual(whole[key]);
    }

    for (const policy of ['guard', 'events', 'project', 'rules']) {
      expect(whole[policy], `${policy} is in the manifest`).toBeDefined();
      expect(descriptor[policy], `${policy} is not in the descriptor`).toBeUndefined();
    }

    expect(descriptor.packages).toHaveLength(1);
    expect(descriptor.theme).toBeDefined();
  });

  test('sync writes the local manifest, the descriptor, and a data-only copy of the descriptor at the old path', () => {
    const root = project();
    const run = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(run.code, run.stderr).toBe(0);
    expect(existsSync(join(root, ManifestConstants.FILE))).toBe(true);
    expect(existsSync(join(root, ManifestConstants.DESCRIPTOR_FILE))).toBe(true);
    expect(readFileSync(join(root, ManifestConstants.LEGACY_FILE), 'utf8')).toBe(
      readFileSync(join(root, ManifestConstants.DESCRIPTOR_FILE), 'utf8'),
    );
    expect(
      Object.keys(JSON.parse(readFileSync(join(root, ManifestConstants.LEGACY_FILE), 'utf8'))),
    ).not.toContain('guard');
    expect(JSON.parse(readFileSync(join(root, ManifestConstants.FILE), 'utf8')).guard.outside).toBe(
      'deny',
    );
  });

  test('an old manifest (the earlier release, with policy) is replaced by the data-only copy, never removed', () => {
    const root = project({ legacy: '{"old":true,"guard":{"outside":"ask"}}\n' });
    const run = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });
    const copy = JSON.parse(readFileSync(join(root, ManifestConstants.LEGACY_FILE), 'utf8'));

    expect(run.code, run.stderr).toBe(0);
    expect(copy.old).toBeUndefined();
    expect(copy.guard).toBeUndefined();
    expect(copy.name).toBe('acme');
  });

  test('doctor names the temporary copy: missing or stale, commit it, kept until the stable release', () => {
    const root = project();
    const found = ProjectContract.checkManifest({
      root,
      config: configOf(root).config,
      configFile: '.configs/vulcan.config.mts',
    }).filter((entry) => entry.file === ManifestConstants.LEGACY_FILE);

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('temporary copy');
    expect(found[0]?.message).toContain('commit it');
  });

  test('doctor asks for the descriptor to be committed and the local manifest only to be synced', () => {
    const root = project();
    const found = ProjectContract.checkManifest({
      root,
      config: configOf(root).config,
      configFile: '.configs/vulcan.config.mts',
    });
    const local = found.find((entry) => entry.file === ManifestConstants.FILE);
    const descriptor = found.find((entry) => entry.file === ManifestConstants.DESCRIPTOR_FILE);

    expect(local?.message).toContain('missing');
    expect(local?.message).not.toContain('commit');
    expect(descriptor?.message).toContain('commit it');
  });
});

describe('a repository that publishes no package has no descriptor', () => {
  const APP_CONFIG = "export default { name: 'shop', guard: { outside: 'deny' } };\n";
  const app = (files: Record<string, string> = {}): string =>
    createProject({
      files: {
        '.configs/vulcan.config.mts': APP_CONFIG,
        'package.json': '{ "name": "shop" }',
        '.gitignore': 'node_modules\n.agents/local/\n',
        ...files,
      },
    });
  const appConfig = (root: string) => ({
    root,
    config: VULCAN_CONFIG_SCHEMA.parse({ name: 'shop', guard: { outside: 'deny' } }),
    configFile: '.configs/vulcan.config.mts',
  });

  test('publishing is signing the atlas index: keys, or none', () => {
    expect(ProjectManifest.publishes({ config: configOf('x').config })).toBe(true);
    expect(ProjectManifest.publishes({ config: appConfig('x').config })).toBe(false);
  });

  test('sync writes only the local manifest', () => {
    const root = app();
    const run = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(run.code, run.stderr).toBe(0);
    expect(existsSync(join(root, ManifestConstants.FILE))).toBe(true);
    expect(existsSync(join(root, ManifestConstants.DESCRIPTOR_FILE))).toBe(false);
    expect(existsSync(join(root, ManifestConstants.LEGACY_FILE))).toBe(false);
    expect(ProjectContract.checkManifest(appConfig(root))).toEqual([]);
  });

  test('a descriptor left untracked by an earlier sync is deleted; doctor asks for the sync until then', () => {
    const root = app({
      [ManifestConstants.DESCRIPTOR_FILE]: '{}\n',
      [ManifestConstants.LEGACY_FILE]: '{}\n',
    });

    initRepo({ cwd: root });
    git({
      cwd: root,
      args: [
        'rm',
        '-q',
        '--cached',
        ManifestConstants.DESCRIPTOR_FILE,
        ManifestConstants.LEGACY_FILE,
      ],
    });

    expect(
      ProjectContract.checkManifest(appConfig(root)).map((entry) => entry.message),
    ).toContainEqual(expect.stringContaining('left from an earlier sync'));

    const run = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(run.code, run.stderr).toBe(0);
    expect(existsSync(join(root, ManifestConstants.DESCRIPTOR_FILE))).toBe(false);
    expect(existsSync(join(root, ManifestConstants.LEGACY_FILE))).toBe(false);
  });

  test('a descriptor git tracks is left, and doctor warns with git rm --cached', () => {
    const root = app({ [ManifestConstants.DESCRIPTOR_FILE]: '{}\n' });

    initRepo({ cwd: root });

    const run = runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    expect(run.code, run.stderr).toBe(0);
    expect(readFileSync(join(root, ManifestConstants.DESCRIPTOR_FILE), 'utf8')).toBe('{}\n');
    expect(ProjectContract.checkManifest(appConfig(root))).toEqual([]);
    expect(
      ProjectContract.checkTrackedDescriptor(appConfig(root)).map((entry) => entry.message),
    ).toEqual([
      `a repository that publishes no package has no descriptor, and git tracks this one: run 'git rm --cached ${ManifestConstants.DESCRIPTOR_FILE}' and delete it`,
    ]);
  });
});
