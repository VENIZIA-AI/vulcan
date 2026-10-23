import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildToolEnvironment } from '../../commands/x.command.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { DoctorChecks, runDoctorChecks } from '../../doctor/index.ts';
import { ManifestConstants, renderManifest } from '../../manifest/index.ts';
import { renderBunfig } from '../../create/bunfig.ts';
import { checkFiles } from '../format.helper.ts';
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
  test('the text is already formatted for bun fmt: short arrays on one line, so lint stays green', () => {
    const root = createProject({ files: { 'bunfig.toml': renderBunfig() } });
    const text = render({ root, config: CONFIG });

    writeFileSync(join(root, 'vulcan.manifest.json'), text);

    const result = checkFiles({ root, glob: 'vulcan.manifest.json' });

    expect(result.code, result.output).toBe(0);
    expect(text).toContain('"aliases": ["k"]');
  });

  test('the contract shape, data only, schemaVersion 1', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
    const manifest = JSON.parse(render({ root, config: CONFIG }));

    expect(Object.keys(manifest)).toEqual([
      '$generated',
      'schemaVersion',
      'name',
      'packages',
      'knowledge',
      'release',
      'rules',
    ]);
    expect(manifest.$generated).toBe('by vulcan sync from .configs/vulcan.config.* - do not edit');
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

describe('package kind in the manifest', () => {
  test('a lib carries its kind and path, an app without a kind carries none', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
    const manifest = JSON.parse(
      render({
        root,
        config: {
          packages: [
            { dir: 'api', name: 'api', path: 'services/api' },
            {
              dir: 'merchant',
              name: '@nx/merchant',
              path: 'auroras/features/merchant',
              kind: 'lib',
            },
          ],
        },
      }),
    );

    expect(manifest.packages[0]).not.toHaveProperty('kind');
    expect(manifest.packages[1]).toMatchObject({ kind: 'lib', path: 'auroras/features/merchant' });
  });
});

describe('layout and presets in the manifest', () => {
  test('rendered after the packages when the config has them, absent otherwise', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
    const preset = { spec: 'ignis', side: 'backend', summary: 'An API.' };
    const manifest = JSON.parse(
      render({
        root,
        config: { ...CONFIG, layout: { backend: 'services', shared: 'libs' }, presets: [preset] },
      }),
    );

    expect(Object.keys(manifest).slice(3, 6)).toEqual(['packages', 'layout', 'presets']);
    expect(manifest.layout).toEqual({ backend: 'services', shared: 'libs' });
    expect(manifest.presets).toEqual([preset]);

    const bare = JSON.parse(render({ root, config: CONFIG }));

    expect('layout' in bare).toBe(false);
    expect('presets' in bare).toBe(false);
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

  test('a manifest written before $generated existed is still current', async () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync'], cwd: root });

    const path = join(root, ManifestConstants.FILE);
    const { $generated, ...old } = JSON.parse(readFileSync(path, 'utf8'));

    writeFileSync(path, `${JSON.stringify(old, null, 2)}\n`);

    expect($generated).toBeDefined();
    expect(JSON.parse(readFileSync(path, 'utf8')).$generated).toBeUndefined();
    expect((await runDoctorChecks({ root })).map(violation => violation.check)).not.toContain(
      DoctorChecks.MANIFEST,
    );
  });

  test('a sync after the old shape writes the key back', () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync'], cwd: root });

    const path = join(root, ManifestConstants.FILE);
    const { $generated, ...old } = JSON.parse(readFileSync(path, 'utf8'));

    writeFileSync(path, `${JSON.stringify(old, null, 2)}\n`);
    runCli({ args: ['sync'], cwd: root });

    expect($generated).toBeDefined();
    expect(JSON.parse(readFileSync(path, 'utf8')).$generated).toBe($generated);
  });

  test('a hand-edited manifest fails C1 and the message says it is generated and how to fix it', () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync'], cwd: root });

    const path = join(root, ManifestConstants.FILE);
    const edited = JSON.parse(readFileSync(path, 'utf8'));

    edited.name = 'edited-by-hand';
    writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);

    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`[${DoctorChecks.MANIFEST}]`);
    expect(result.stderr).toContain('generated');
    expect(result.stderr).toContain("run 'bun x --no-install vulcan sync'");
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
