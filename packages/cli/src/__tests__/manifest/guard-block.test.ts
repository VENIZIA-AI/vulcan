import { afterAll, describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { isManifestCurrent, renderManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
const render = (config: object): string =>
  renderManifest({ root, config: VULCAN_CONFIG_SCHEMA.parse(config) });

const GUARD = {
  writes: {
    commands: [
      { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' },
      {
        rule: 'V-W-02',
        what: 'running a migration',
        pattern: '\\bbun run migrate:',
        ignoreCase: true,
      },
    ],
  },
  git: { askPush: ['develop'] },
};

describe('the guard block of the manifest', () => {
  test('carries the project commands and push targets, where a hook reads them with no config and no zod', () => {
    const manifest = JSON.parse(render({ guard: GUARD }));

    expect(manifest.guard).toEqual({
      writes: {
        commands: [
          { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' },
          {
            rule: 'V-W-02',
            what: 'running a migration',
            pattern: '\\bbun run migrate:',
            ignoreCase: true,
          },
        ],
      },
      git: { askPush: ['develop'] },
    });
    expect(manifest.schemaVersion).toBe(1);
  });

  test('a config that lists neither renders the text it always did, trustedScripts included', () => {
    const plain = render({});

    expect(render({ guard: { writes: { commands: [] }, git: { askPush: [] } } })).toBe(plain);
    expect(render({ guard: { writes: { trustedScripts: [] } } })).toBe(plain);
    expect(JSON.parse(plain)).not.toHaveProperty('guard');
  });

  test('only what is set is written: commands alone, or push targets alone', () => {
    expect(JSON.parse(render({ guard: { git: { askPush: ['main'] } } })).guard).toEqual({
      git: { askPush: ['main'] },
    });
    expect(
      JSON.parse(render({ guard: { writes: { commands: [GUARD.writes.commands[0]] } } })).guard,
    ).toEqual({ writes: { commands: [GUARD.writes.commands[0]] } });
  });

  test('sits after the atlas block and before the remote-host policy', () => {
    const keys = Object.keys(
      JSON.parse(
        render({
          atlas: { prebuilt: false },
          guard: GUARD,
          remoteHosts: { trusted: ['github.com'] },
        }),
      ),
    );

    expect(keys.indexOf('atlas')).toBeLessThan(keys.indexOf('guard'));
    expect(keys.indexOf('guard')).toBeLessThan(keys.indexOf('remoteHosts'));
  });

  test('a manifest rendered before a pattern was added is stale against the config', () => {
    expect(isManifestCurrent({ committed: render({}), rendered: render({ guard: GUARD }) })).toBe(
      false,
    );
  });
});
