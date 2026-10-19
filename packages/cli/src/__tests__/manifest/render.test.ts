import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildToolEnvironment } from '../../commands/x.command.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { DoctorChecks, runDoctorChecks } from '../../doctor/index.ts';
import { ManifestConstants, renderManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const CONFIG = {
  packages: [
    { dir: 'kernel', name: '@x/kernel', aliases: ['k'] },
    { dir: 'old', name: '@x/old', retired: true, path: 'umbras/old' },
  ],
  knowledge: {
    bundle: '.agents/knowledge',
    changelogs: 'docs/changes',
    syncAreas: '.agents/knowledge/process/sync-areas.md',
  },
  atlas: { tagPattern: '<dir>-v<version>', ignoreTags: ['*/0.0.1-0'] },
};

const render = (opts: { root: string; config: object }): string =>
  renderManifest({ root: opts.root, config: VULCAN_CONFIG_SCHEMA.parse(opts.config) });

describe('renderManifest', () => {
  test('the contract shape, data only, schemaVersion 1', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
    const manifest = JSON.parse(render({ root, config: CONFIG }));

    expect(Object.keys(manifest)).toEqual([
      'schemaVersion',
      'name',
      'packages',
      'knowledge',
      'release',
      'rules',
    ]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.name).toBe('acme');
    expect(manifest.packages).toEqual([
      { name: '@x/kernel', dir: 'kernel', path: 'packages/kernel', aliases: ['k'], retired: false },
      { name: '@x/old', dir: 'old', path: 'umbras/old', aliases: [], retired: true },
    ]);
    expect(manifest.knowledge).toEqual({
      bundle: '.agents/knowledge',
      changelogs: 'docs/changes',
      syncAreas: '.agents/knowledge/process/sync-areas.md',
    });
    expect(manifest.release).toEqual({
      tagPattern: '<dir>-v<version>',
      ignoreTags: ['*/0.0.1-0'],
    });
    expect(manifest.rules.project).toBe('.agents/rules.md');
  });

  test('every base rule is recorded with a hash of its text', () => {
    const root = createProject({ files: {} });
    const { base } = JSON.parse(render({ root, config: {} })).rules;

    expect(Object.keys(base)).toContain('V-W-01');
    expect(Object.values(base).every(hash => /^[0-9a-f]{8}$/.test(String(hash)))).toBe(true);
  });

  test("the config's name wins; without one or a package name, the directory's", () => {
    const root = createProject({ files: {} });

    expect(JSON.parse(render({ root, config: { name: 'demo' } })).name).toBe('demo');
    expect(JSON.parse(render({ root, config: {} })).name).toBe(
      root.split('/').pop()?.toLowerCase(),
    );
  });

  test("a consumer's sources ride in its manifest - atlas reads nothing else", () => {
    const root = createProject({ files: {} });
    const withSources = JSON.parse(
      render({
        root,
        config: { atlas: { sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis' }] } },
      }),
    );

    expect(withSources.sources).toEqual([
      { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
    ]);
    expect(JSON.parse(render({ root, config: {} })).sources).toBeUndefined();
  });

  test('byte-stable: the same config renders the same text', () => {
    const root = createProject({ files: {} });

    expect(render({ root, config: CONFIG })).toBe(render({ root, config: CONFIG }));
  });
});

describe('the manifest in sync, doctor and vulcan x', () => {
  const PROJECT = {
    '.configs/vulcan.config.ts': `export default ${JSON.stringify(CONFIG)};\n`,
    'AGENTS.md': '# x\n',
  };

  test('sync writes it, and a second sync leaves it unchanged', () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync'], cwd: root });

    expect(existsSync(join(root, ManifestConstants.FILE))).toBe(true);
    expect(runCli({ args: ['sync'], cwd: root }).stderr).toContain(
      `unchanged ${ManifestConstants.FILE}`,
    );
  });

  test('doctor fails a manifest the config moved past', async () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync'], cwd: root });

    const fresh = await runDoctorChecks({ root });

    // Positive control: the same check, after the config changes under the committed manifest - in
    // a new process, as doctor runs: this one has the first config module cached.
    writeFileSync(join(root, '.configs/vulcan.config.ts'), "export default { name: 'moved' };\n");

    const stale = runCli({ args: ['doctor'], cwd: root });

    expect(fresh.map(violation => violation.check)).not.toContain(DoctorChecks.MANIFEST);
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain(`[${DoctorChecks.MANIFEST}]`);
    expect(stale.stderr).toContain('stale against the config');
  });

  test('vulcan x hands the tool the manifest, rendered fresh', async () => {
    const root = createProject({ files: PROJECT });
    const environment = await buildToolEnvironment({ root });

    expect(environment.ok).toBe(true);

    if (environment.ok) {
      expect(environment.env.VULCAN_MANIFEST).toBe(render({ root, config: CONFIG }));
      expect(readFileSync(join(root, '.configs/vulcan.config.ts'), 'utf8')).toContain('@x/kernel');
    }
  });
});
