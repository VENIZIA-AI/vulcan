import { afterAll, describe, expect, test } from 'bun:test';
import { ProjectContract } from '../../doctor/checks.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const STATUS = '.agents/local/cache/atlas/status.json';
const context = (root: string) => ({
  root,
  config: VULCAN_CONFIG_SCHEMA.parse({}),
  configFile: '.configs/vulcan.config.mts',
});
const recorded = (sources: Record<string, object>): string =>
  createProject({ files: { [STATUS]: JSON.stringify({ version: 1, sources }) } });

describe('doctor and the atlas sources the last server run recorded', () => {
  test('a failed source is a warning with its error; a ready one, a recent build and no record are quiet', () => {
    const now = Date.now();
    const failed = ProjectContract.checkAtlasSources(
      context(recorded({ ignis: { state: 'failed', since: now, error: 'the remote is down' } })),
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]?.check).toBe('atlas-source');
    expect(failed[0]?.message).toContain('ignis: failed');
    expect(failed[0]?.message).toContain('the remote is down');
    expect(failed[0]?.message).toContain('x atlas status');

    for (const root of [
      recorded({ ignis: { state: 'ready', since: now, durationMs: 9000 } }),
      recorded({ ignis: { state: 'building', since: now - 30_000 } }),
      createProject({ files: {} }),
    ]) {
      expect(ProjectContract.checkAtlasSources(context(root))).toEqual([]);
    }
  });

  test('a build running for over ten minutes is a warning', () => {
    const stuck = ProjectContract.checkAtlasSources(
      context(recorded({ ardor: { state: 'building', since: Date.now() - 11 * 60_000 } })),
    );

    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.message).toContain('over 10 minutes');
  });
});
