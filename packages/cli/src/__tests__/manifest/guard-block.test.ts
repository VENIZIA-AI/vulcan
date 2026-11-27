import { afterAll, describe, expect, test } from 'bun:test';
import { VulcanConfigSchema } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
const render = (config: object): string =>
  ProjectManifest.render({ root, config: VulcanConfigSchema.parse(config) });

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

  test('a config that lists neither renders the text it always did', () => {
    const plain = render({});

    expect(render({ guard: { writes: { commands: [] }, git: { askPush: [] } } })).toBe(plain);
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

  test('guard.runners.allow is written when it lists a name, and a name that is not one is refused', () => {
    expect(JSON.parse(render({ guard: { runners: { allow: ['shadcn'] } } })).guard).toEqual({
      runners: { allow: ['shadcn'] },
    });
    expect(JSON.parse(render({ guard: { runners: { allow: [] } } }))).not.toHaveProperty('guard');
    expect(JSON.parse(render({ guard: { runners: { allow: ['@acme/tool'] } } })).guard).toEqual({
      runners: { allow: ['@acme/tool'] },
    });

    for (const name of ['@venizia', '@/x', '@a/b/c', 'a b', '--yes', '*', '']) {
      expect(() => render({ guard: { runners: { allow: [name] } } })).toThrow();
    }
  });

  test('sits after the atlas block and before the theme block', () => {
    const keys = Object.keys(
      JSON.parse(
        render({
          atlas: { prebuilt: false },
          guard: GUARD,
        }),
      ),
    );

    expect(keys.indexOf('atlas')).toBeLessThan(keys.indexOf('guard'));
    expect(keys.indexOf('guard')).toBeLessThan(keys.indexOf('theme'));
  });

  test('outside is written when it is deny, and toolOwnedPaths when it lists any; the defaults write nothing', () => {
    expect(
      JSON.parse(render({ guard: { outside: 'deny', toolOwnedPaths: ['/srv/store/**'] } })).guard,
    ).toEqual({ outside: 'deny', toolOwnedPaths: ['/srv/store/**'] });
    expect(render({ guard: { outside: 'ask', toolOwnedPaths: [] } })).toBe(render({}));
  });

  test('asks is written when it is deny, beside outside, and the default writes nothing', () => {
    expect(JSON.parse(render({ guard: { asks: 'deny' } })).guard).toEqual({ asks: 'deny' });
    expect(JSON.parse(render({ guard: { asks: 'deny', outside: 'deny' } })).guard).toEqual({
      outside: 'deny',
      asks: 'deny',
    });
    expect(render({ guard: { asks: 'ask' } })).toBe(render({}));
  });

  test('a manifest rendered before a pattern was added differs from the one the config renders', () => {
    expect(render({})).not.toBe(render({ guard: GUARD }));
  });
});
