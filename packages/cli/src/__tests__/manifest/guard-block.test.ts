import { afterAll, describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
const render = (config: object): string =>
  ProjectManifest.render({ root, config: VULCAN_CONFIG_SCHEMA.parse(config) });

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

  test('a manifest rendered before a pattern was added differs from the one the config renders', () => {
    expect(render({})).not.toBe(render({ guard: GUARD }));
  });
});

describe('the guard block and the read-only scripts', () => {
  const ENTRY = { script: 'scripts/release/release-run.ts', readOnly: ['plan', 'registry'] };

  test('carries the object entries of trustedScripts as writes.readOnlyScripts, after the commands', () => {
    const manifest = JSON.parse(
      render({
        guard: { writes: { trustedScripts: ['cli.ts', ENTRY], commands: GUARD.writes.commands } },
      }),
    );

    expect(manifest.guard.writes.trustedScripts).toEqual(['cli.ts']);
    expect(manifest.guard.writes.readOnlyScripts).toEqual([ENTRY]);
    expect(Object.keys(manifest.guard.writes)).toEqual([
      'commands',
      'trustedScripts',
      'readOnlyScripts',
    ]);
  });

  test('an object entry alone writes only the entry', () => {
    expect(JSON.parse(render({ guard: { writes: { trustedScripts: [ENTRY] } } })).guard).toEqual({
      writes: { readOnlyScripts: [ENTRY] },
    });
  });

  test('shell and node scripts are written as writes.trustedScripts, next to the bun ones', () => {
    const scripts = [
      'tools/deploy.sh',
      'tools/check.js',
      'tools/check.mjs',
      'tools/check.cjs',
      'cli.ts',
    ];
    const manifest = JSON.parse(render({ guard: { writes: { trustedScripts: scripts } } }));

    expect(manifest.guard.writes.trustedScripts).toEqual(scripts);
    expect(manifest.guard.writes.readOnlyScripts).toBeUndefined();
  });
  test('a list of path strings is written as writes.trustedScripts: the hook reads them here, not from the config', () => {
    expect(
      JSON.parse(render({ guard: { writes: { trustedScripts: ['cli.ts', 'tools/b.ts'] } } })).guard,
    ).toEqual({ writes: { trustedScripts: ['cli.ts', 'tools/b.ts'] } });
  });

  test('outside is written when it is deny, and toolOwnedPaths when it lists any; the defaults write nothing', () => {
    expect(
      JSON.parse(render({ guard: { outside: 'deny', toolOwnedPaths: ['/srv/store/**'] } })).guard,
    ).toEqual({ outside: 'deny', toolOwnedPaths: ['/srv/store/**'] });
    expect(render({ guard: { outside: 'ask', toolOwnedPaths: [] } })).toBe(render({}));
  });

  test('a manifest rendered before an entry was added differs from the one the config renders', () => {
    expect(render({})).not.toBe(render({ guard: { writes: { trustedScripts: [ENTRY] } } }));
  });
});
