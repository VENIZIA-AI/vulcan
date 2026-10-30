import { describe, expect, test } from 'bun:test';
import { toAtlasProject } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { Transport } from '@/protocol';
import { buildPresetsTool } from '@/tools';
import type { IOfficialPreset } from '@/tools/common';

const MANIFEST = {
  schemaVersion: 1,
  name: 'shop',
  layout: { backend: 'services', frontend: 'web', shared: 'libs' },
  packages: [
    { name: 'api', dir: 'api', path: 'services/api', aliases: [], retired: false },
    {
      name: '@shop/money',
      dir: 'money',
      path: 'libs/money',
      aliases: [],
      retired: false,
      kind: 'lib',
    },
  ],
  presets: [
    { spec: 'ignis', side: 'backend', summary: 'An IGNIS API on Bun.', lib: 'An IGNIS library.' },
    { spec: 'file:../acme-web', side: 'frontend', summary: 'An admin.' },
  ],
};

const SHARED_MANIFEST = {
  ...MANIFEST,
  presets: [
    {
      spec: 'ignis',
      side: 'backend',
      summary: 'An IGNIS API on Bun.',
      lib: 'An IGNIS library.',
      shared: 'An IGNIS side-neutral package.',
    },
    { spec: 'file:../acme-web', side: 'frontend', summary: 'An admin.' },
  ],
};

const projectOf = (opts: { manifest?: unknown } = {}): IAtlasProject =>
  toAtlasProject({ root: '/work/shop', manifest: opts.manifest ?? MANIFEST });

const ask = async (opts: {
  project?: IAtlasProject;
  args?: Record<string, unknown>;
  official?: IOfficialPreset[];
}) => {
  const tool = buildPresetsTool({
    project: 'project' in opts ? opts.project : projectOf(),
    official: opts.official,
  });
  const transport = new Transport({ tools: [tool], serverName: 'shop-atlas', serverVersion: '0' });
  const reply = JSON.parse(
    (await transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'presets', arguments: opts.args ?? {} },
      }),
    })) ?? 'null',
  );

  return reply.error === undefined ? JSON.parse(reply.result.content[0].text) : reply.error;
};

describe('the manifest carries what presets needs', () => {
  test('layout, presets and the kind of a package are read', () => {
    const project = projectOf();

    expect(project.layout).toEqual({ backend: 'services', frontend: 'web', shared: 'libs' });
    expect(project.presets?.map((item) => item.spec)).toEqual(['ignis', 'file:../acme-web']);
    expect(project.packages.find((item) => item.dir === 'money')?.kind).toBe('lib');
  });

  test('a shared summary on a preset is kept, and a preset without one has none', () => {
    const project = projectOf({ manifest: SHARED_MANIFEST });

    expect(project.presets?.[0]).toEqual({
      spec: 'ignis',
      side: 'backend',
      summary: 'An IGNIS API on Bun.',
      lib: 'An IGNIS library.',
      shared: 'An IGNIS side-neutral package.',
    });
    expect(project.presets?.[1]).not.toHaveProperty('shared');
  });

  test('a shared summary that is not a string is dropped, the preset kept', () => {
    const project = projectOf({
      manifest: {
        ...MANIFEST,
        presets: [{ spec: 'ignis', side: 'backend', summary: 'An API.', shared: 7 }],
      },
    });

    expect(project.presets).toEqual([{ spec: 'ignis', side: 'backend', summary: 'An API.' }]);
  });

  test('the presetKind of a package is read, and a package without one has none', () => {
    const project = projectOf({
      manifest: {
        ...MANIFEST,
        packages: [
          ...MANIFEST.packages,
          {
            name: '@shop/common',
            dir: 'common',
            path: 'libs/common',
            aliases: [],
            retired: false,
            kind: 'lib',
            presetKind: 'shared',
          },
          {
            name: '@shop/kit',
            dir: 'kit',
            path: 'libs/kit',
            kind: 'lib',
            presetKind: 'lib',
          },
        ],
      },
    });
    const entry = (dir: string) => project.packages.find((item) => item.dir === dir);

    expect(entry('common')).toMatchObject({ kind: 'lib', presetKind: 'shared' });
    expect(entry('kit')?.presetKind).toBe('lib');
    expect(entry('money')).not.toHaveProperty('presetKind');
    expect(entry('api')).not.toHaveProperty('presetKind');
  });

  test('a presetKind that is neither lib nor shared is dropped, the package kept', () => {
    const project = projectOf({
      manifest: {
        ...MANIFEST,
        packages: [{ name: '@shop/odd', dir: 'odd', kind: 'lib', presetKind: 'neutral' }],
      },
    });

    expect(project.packages).toHaveLength(1);
    expect(project.packages[0]).not.toHaveProperty('presetKind');
  });

  test('a manifest without them reads as none', () => {
    const project = projectOf({ manifest: { schemaVersion: 1, name: 'bare' } });

    expect(project.layout).toBeUndefined();
    expect(project.presets).toBeUndefined();
  });
});

describe('presets (kind app)', () => {
  test('lists each recorded preset first, then the official ones the project has not used, with the exact command', async () => {
    const answer = await ask({ args: { name: 'api3' } });

    expect(answer.kind).toBe('app');
    expect(answer.presets).toEqual([
      {
        preset: 'ignis',
        side: 'backend',
        summary: 'An IGNIS API on Bun.',
        folder: 'services',
        command: 'bun x --no-install vulcan add --preset ignis --app api3',
        inProject: true,
      },
      {
        preset: 'file:../acme-web',
        side: 'frontend',
        summary: 'An admin.',
        folder: 'web',
        command:
          'bun x --no-install vulcan add --preset file:../acme-web --app api3 --api <backend app> | --no-api',
        inProject: true,
      },
      {
        preset: 'ardor',
        side: 'frontend',
        summary: 'ARDOR: a frontend app on Vite and React (official; not yet in this project)',
        folder: 'web',
        command:
          'bun x --no-install vulcan add --preset ardor --app api3 --api <backend app> | --no-api',
        inProject: false,
      },
    ]);
  });

  test('an official preset the project already recorded is listed once, as in the project', async () => {
    const answer = await ask({ args: { name: 'x', side: 'backend' } });

    expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual(['ignis']);
  });

  test('a project with no recorded preset gets the official ones, every one marked as not in it', async () => {
    const answer = await ask({
      project: projectOf({
        manifest: { schemaVersion: 1, name: 'bare', layout: { backend: 'be' } },
      }),
      args: { name: 'api3' },
    });

    expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual([
      'ignis',
      'ardor',
    ]);
    expect(answer.presets.every((item: { inProject: boolean }) => item.inProject === false)).toBe(
      true,
    );
    expect(answer.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --app api3',
    );
    expect(answer.presets[1].command).toBe(
      'bun x --no-install vulcan add --preset ardor --app api3 --frontend-dir <folder> --api <backend app> | --no-api',
    );
    expect(answer.note).toBe(
      'this project recorded no preset: the entries are the official ones, marked inProject false; ask the user which to use',
    );
  });

  test('without a name the command carries <name>; kind app is the default', async () => {
    const answer = await ask({});

    expect(answer.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --app <name>',
    );
  });

  test('a side with no folder in the layout asks for one, never invents it', async () => {
    const project = projectOf({
      manifest: { ...MANIFEST, layout: { shared: 'libs' } },
    });
    const answer = await ask({ project, args: { name: 'api3' } });

    expect(answer.presets[0].folder).toBeNull();
    expect(answer.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --app api3 --backend-dir <folder>',
    );
  });

  test('a side with several folders lists them and asks for one with the folder flag', async () => {
    const project = projectOf({
      manifest: {
        ...MANIFEST,
        layout: {
          backend: 'umbras',
          frontend: ['auroras/apps', 'auroras/guests'],
          shared: ['auroras/kits', 'auroras/features'],
        },
      },
    });
    const app = await ask({ project, args: { name: 'shop', side: 'frontend' } });
    const lib = await ask({ project, args: { kind: 'lib', name: 'money' } });
    const backend = await ask({ project, args: { name: 'api3', side: 'backend' } });

    expect(app.presets[0].folder).toBeNull();
    expect(app.presets[0].folders).toEqual(['auroras/apps', 'auroras/guests']);
    expect(app.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset file:../acme-web --app shop --frontend-dir <auroras/apps|auroras/guests> --api <backend app> | --no-api',
    );
    expect(lib.presets[0].folders).toEqual(['auroras/kits', 'auroras/features']);
    expect(lib.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --lib money --dir <auroras/kits|auroras/features>',
    );
    // One folder in a list is the folder, as a string was.
    expect(backend.presets[0].folder).toBe('umbras');
    expect(backend.presets[0].folders).toBeUndefined();
    expect(backend.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --app api3',
    );
  });

  test('side narrows the list', async () => {
    const answer = await ask({ args: { side: 'frontend' } });

    expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual([
      'file:../acme-web',
      'ardor',
    ]);
  });
});

describe('presets (official, not yet used)', () => {
  test('a recorded @venizia/ardor with a pinned version counts as ardor: listed once, in the project', async () => {
    const project = projectOf({
      manifest: {
        ...MANIFEST,
        presets: [{ spec: '@venizia/ardor@0.3.4', side: 'frontend', summary: 'An ARDOR app.' }],
      },
    });
    const answer = await ask({ project, args: { name: 'web', side: 'frontend' } });

    expect(answer.presets).toHaveLength(1);
    expect(answer.presets[0]).toMatchObject({ preset: '@venizia/ardor@0.3.4', inProject: true });
  });

  test('without a project at all the official presets are still answered, with folder placeholders', async () => {
    const answer = await ask({ project: undefined, args: { name: 'api3' } });

    expect(answer.presets.map((item: { command: string }) => item.command)).toEqual([
      'bun x --no-install vulcan add --preset ignis --app api3 --backend-dir <folder>',
      'bun x --no-install vulcan add --preset ardor --app api3 --frontend-dir <folder> --api <backend app> | --no-api',
    ]);
  });

  test('side frontend with only a backend recorded: ardor, with a note that no recorded preset makes it', async () => {
    const project = projectOf({
      manifest: { ...MANIFEST, presets: [{ spec: 'ignis', side: 'backend', summary: 'An API.' }] },
    });
    const answer = await ask({ project, args: { side: 'frontend' } });

    expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual(['ardor']);
    expect(answer.note).toContain('no recorded preset makes a frontend');
  });
});

describe('presets (kind lib)', () => {
  test('the recorded presets that make a library first, then the official libraries not yet in the project, with the shared folder', async () => {
    const answer = await ask({ args: { kind: 'lib', name: 'billing' } });

    expect(answer.kind).toBe('lib');
    expect(answer.presets).toEqual([
      {
        preset: 'ignis',
        summary: 'An IGNIS library.',
        folder: 'libs',
        command: 'bun x --no-install vulcan add --preset ignis --lib billing',
        inProject: true,
      },
      {
        preset: 'ardor',
        summary: 'ARDOR: a feature package other apps import (official; not yet in this project)',
        folder: 'libs',
        command: 'bun x --no-install vulcan add --preset ardor --lib billing',
        inProject: false,
      },
    ]);
  });

  test('without a shared folder the folder of the existing libs, else a placeholder', async () => {
    const noShared = projectOf({ manifest: { ...MANIFEST, layout: { backend: 'services' } } });
    const fromLibs = await ask({ project: noShared, args: { kind: 'lib', name: 'billing' } });
    const bare = projectOf({
      manifest: {
        ...MANIFEST,
        layout: { backend: 'services' },
        packages: [{ name: 'api', dir: 'api', path: 'services/api' }],
      },
    });
    const none = await ask({ project: bare, args: { kind: 'lib', name: 'billing' } });

    expect(fromLibs.presets[0].folder).toBe('libs');
    expect(fromLibs.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --lib billing',
    );
    expect(none.presets[0].folder).toBeNull();
    expect(none.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --lib billing --dir <folder>',
    );
  });

  test('a project whose recorded presets make no library gets the official ones, marked not in the project, with a note', async () => {
    const project = projectOf({
      manifest: { ...MANIFEST, presets: [{ spec: 'ignis', side: 'backend', summary: 'An API.' }] },
    });
    const answer = await ask({ project, args: { kind: 'lib', name: 'billing' } });

    expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual([
      'ignis',
      'ardor',
    ]);
    expect(answer.presets.every((item: { inProject: boolean }) => item.inProject === false)).toBe(
      true,
    );
    expect(answer.note).toBe(
      'no recorded preset makes a lib: the entries are the official ones, marked inProject false; ask the user which to use, and do not hand-write package.json, tsconfig or scripts',
    );
  });
});

describe('presets (kind shared)', () => {
  test('lists the recorded presets that have a shared summary, with the shared flag and the folder', async () => {
    const answer = await ask({
      project: projectOf({ manifest: SHARED_MANIFEST }),
      args: { kind: 'shared', name: 'contracts' },
    });

    expect(answer.kind).toBe('shared');
    expect(answer.presets).toEqual([
      {
        preset: 'ignis',
        summary: 'An IGNIS side-neutral package.',
        folder: 'libs',
        command: 'bun x --no-install vulcan add --preset ignis --shared contracts',
        inProject: true,
      },
    ]);
    expect(answer.note).toBeUndefined();
  });

  test('a preset with only a lib kind is left out of shared, and one with only a shared kind is left out of lib', async () => {
    const project = projectOf({
      manifest: {
        ...MANIFEST,
        presets: [
          { spec: 'ignis', side: 'backend', summary: 'An API.', lib: 'A lib.' },
          { spec: 'file:../kit', side: 'frontend', summary: 'A kit.', shared: 'Shared.' },
        ],
      },
    });
    const shared = await ask({ project, args: { kind: 'shared', name: 'x' } });
    const lib = await ask({ project, args: { kind: 'lib', name: 'x' } });

    expect(shared.presets.map((item: { preset: string }) => item.preset)).toEqual(['file:../kit']);
    expect(lib.presets.map((item: { preset: string }) => item.preset)).toEqual(['ignis', 'ardor']);
    expect(lib.presets[0].command).toContain('--lib x');
  });

  test('a shared folder list asks for one with the dir flag', async () => {
    const project = projectOf({
      manifest: {
        ...SHARED_MANIFEST,
        layout: { ...MANIFEST.layout, shared: ['libs/a', 'libs/b'] },
      },
    });
    const answer = await ask({ project, args: { kind: 'shared', name: 'contracts' } });

    expect(answer.presets[0].folders).toEqual(['libs/a', 'libs/b']);
    expect(answer.presets[0].command).toBe(
      'bun x --no-install vulcan add --preset ignis --shared contracts --dir <libs/a|libs/b>',
    );
  });

  test('with no preset that has a shared kind it says so and invents no command', async () => {
    const answer = await ask({ args: { kind: 'shared', name: 'contracts' } });

    expect(answer.kind).toBe('shared');
    expect(answer.presets).toEqual([]);
    expect(answer.note).toContain('no preset makes a shared');
    expect(JSON.stringify(answer)).not.toContain('vulcan add');
  });

  test('without a project the answer is the same: no shared preset, no command', async () => {
    const answer = await ask({ project: undefined, args: { kind: 'shared', name: 'contracts' } });

    expect(answer.presets).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain('vulcan add');
  });

  describe('an official preset that has a shared kind', () => {
    const OFFICIAL: IOfficialPreset[] = [
      {
        id: 'forge',
        side: 'backend',
        summary: 'Forge app.',
        lib: 'Forge library.',
        shared: 'Forge side-neutral package.',
      },
      { id: 'plain', side: 'frontend', summary: 'Plain app.', lib: 'Plain library.' },
    ];

    test('is named with its command and marked as not in the project; one without a shared kind is left out', async () => {
      const answer = await ask({
        project: projectOf(),
        official: OFFICIAL,
        args: { kind: 'shared', name: 'contracts' },
      });

      expect(answer.presets).toEqual([
        {
          preset: 'forge',
          summary: 'Forge side-neutral package.',
          folder: 'libs',
          command: 'bun x --no-install vulcan add --preset forge --shared contracts',
          inProject: false,
        },
      ]);
      expect(answer.note).toBe(
        'no recorded preset makes a shared: the entries are the official ones, marked inProject false; ask the user which to use, and do not hand-write package.json, tsconfig or scripts',
      );
    });

    test('is listed once when the project recorded it with a shared kind, as in the project', async () => {
      const project = projectOf({
        manifest: {
          ...MANIFEST,
          presets: [
            { spec: '@venizia/forge@1.2.3', side: 'backend', summary: 'An app.', shared: 'Mine.' },
          ],
        },
      });
      const answer = await ask({
        project,
        official: OFFICIAL,
        args: { kind: 'shared', name: 'contracts' },
      });

      expect(answer.presets).toEqual([
        {
          preset: '@venizia/forge@1.2.3',
          summary: 'Mine.',
          folder: 'libs',
          command: 'bun x --no-install vulcan add --preset @venizia/forge@1.2.3 --shared contracts',
          inProject: true,
        },
      ]);
      expect(answer.note).toBeUndefined();
    });

    test('is still offered when the project recorded the same package without its shared kind', async () => {
      const project = projectOf({
        manifest: {
          ...MANIFEST,
          presets: [{ spec: 'forge', side: 'backend', summary: 'An app.', lib: 'A lib.' }],
        },
      });
      const answer = await ask({
        project,
        official: OFFICIAL,
        args: { kind: 'shared', name: 'contracts' },
      });

      expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual(['forge']);
      expect(answer.presets[0].inProject).toBe(false);
    });

    test('does not change what kind app and kind lib list', async () => {
      const lib = await ask({ official: OFFICIAL, args: { kind: 'lib', name: 'billing' } });

      expect(lib.presets.map((item: { preset: string }) => item.preset)).toEqual([
        'ignis',
        'forge',
        'plain',
      ]);
    });
  });

  test('kind app and kind lib list what they listed before when a preset also has a shared kind', async () => {
    const project = projectOf({ manifest: SHARED_MANIFEST });
    const app = await ask({ project, args: { name: 'api3', side: 'backend' } });
    const lib = await ask({ project, args: { kind: 'lib', name: 'billing' } });

    expect(app.presets).toEqual([
      {
        preset: 'ignis',
        side: 'backend',
        summary: 'An IGNIS API on Bun.',
        folder: 'services',
        command: 'bun x --no-install vulcan add --preset ignis --app api3',
        inProject: true,
      },
    ]);
    expect(lib.presets).toEqual([
      {
        preset: 'ignis',
        summary: 'An IGNIS library.',
        folder: 'libs',
        command: 'bun x --no-install vulcan add --preset ignis --lib billing',
        inProject: true,
      },
      {
        preset: 'ardor',
        summary: 'ARDOR: a feature package other apps import (official; not yet in this project)',
        folder: 'libs',
        command: 'bun x --no-install vulcan add --preset ardor --lib billing',
        inProject: false,
      },
    ]);
  });
});

describe('presets (nothing fits)', () => {
  test('a kind no preset makes is said plainly, never pointed at an app preset', async () => {
    for (const kind of ['feature', 'tool', 'service']) {
      const answer = await ask({ args: { kind } });

      expect(answer.presets).toEqual([]);
      expect(answer.note).toBe(
        `no preset makes a ${kind} (vulcan add makes apps, libs and shared packages): ask the user how it should be made; do not hand-write package.json, tsconfig or scripts, and do not use an app, lib or shared preset for it`,
      );
    }
  });

  test('a name that is not a name is refused', async () => {
    const answer = await ask({ args: { name: 'Api 3' } });

    expect(answer.message).toContain('name');
  });
});

describe('the tool description', () => {
  test('opens with when to call it', () => {
    const { description } = buildPresetsTool({ project: projectOf() }).definition;

    expect(description).toStartWith(
      'When you are asked to create a new app or package in shop, ask here which preset and which exact command to use before you write any file.',
    );
  });

  test('without a project it still says what it does', () => {
    expect(buildPresetsTool({ project: undefined }).definition.description).toContain(
      'When you are asked to create a new app or package',
    );
  });
});
