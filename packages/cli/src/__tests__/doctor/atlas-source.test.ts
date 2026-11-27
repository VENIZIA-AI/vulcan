import { afterAll, describe, expect, test } from 'bun:test';
import { CloneChecks } from '../../doctor/clone-checks.ts';
import { VulcanConfigSchema } from '../../config/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  name: 'app',
  packages: [],
  knowledge: { bundle: '.agents/knowledge' },
  release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
  sources: [
    { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
    { name: 'ardor', repo: 'VENIZIA-AI/ardor', ref: 'develop' },
  ],
});
const STATUS = '.agents/local/cache/atlas/status.json';
const context = (root: string) => ({
  root,
  config: VulcanConfigSchema.parse({}),
  configFile: '.configs/vulcan.config.mts',
});
const recorded = (sources: Record<string, object>, at = STATUS): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': MANIFEST,
      [at]: JSON.stringify({ version: 1, sources }),
    },
  });

describe('doctor and the atlas sources the last server run recorded', () => {
  test('a failed source and a failed refresh are warnings; a ready one, a recent build and no record are quiet', () => {
    const now = Date.now();
    const failed = CloneChecks.checkAtlasSources(
      context(recorded({ ignis: { state: 'failed', since: now, error: 'the remote is down' } })),
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]?.check).toBe('atlas-source');
    expect(failed[0]?.message).toContain('ignis: failed (the remote is down)');
    expect(failed[0]?.message).toContain('atlas status');

    const refresh = CloneChecks.checkAtlasSources(
      context(
        recorded({
          ignis: { state: 'failed', since: now, error: 'offline', resolved: { name: 'ignis' } },
        }),
      ),
    );

    expect(refresh[0]?.message).toContain('ignis: refresh-failed (offline)');

    for (const root of [
      recorded({ ignis: { state: 'ready', since: now, durationMs: 9000 } }),
      recorded({ ignis: { state: 'building', since: now - 30_000, pid: process.pid } }),
      createProject({ files: { '.agents/vulcan.manifest.json': MANIFEST } }),
    ]) {
      expect(CloneChecks.checkAtlasSources(context(root))).toEqual([]);
    }
  });

  test('a build over ten minutes warns when its server is alive, and is quiet when a closed session left it', () => {
    const old = Date.now() - 11 * 60_000;

    expect(
      CloneChecks.checkAtlasSources(
        context(recorded({ ardor: { state: 'building', since: old, pid: process.pid } })),
      )[0]?.message,
    ).toContain('ardor: hung');
    expect(
      CloneChecks.checkAtlasSources(
        context(recorded({ ardor: { state: 'building', since: old, pid: 2 ** 22 - 1 } })),
      ),
    ).toEqual([]);
  });

  test('a source the config no longer declares is not a warning, and a custom cache folder is followed', () => {
    const now = Date.now();

    expect(
      CloneChecks.checkAtlasSources(
        context(recorded({ gone: { state: 'failed', since: now, error: 'x' } })),
      ),
    ).toEqual([]);

    const root = recorded(
      { ignis: { state: 'failed', since: now, error: 'x' } },
      'elsewhere/atlas/status.json',
    );

    expect(CloneChecks.checkAtlasSources(context(root))).toEqual([]);
  });
});
