import { describe, expect, test } from 'bun:test';
import { toAtlasProject } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { Transport } from '@/protocol';
import { buildPresetsTool } from '@/tools';

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

const projectOf = (opts: { manifest?: unknown } = {}): IAtlasProject =>
  toAtlasProject({ root: '/work/shop', manifest: opts.manifest ?? MANIFEST });

const ask = async (opts: { project?: IAtlasProject; args?: Record<string, unknown> }) => {
  const tool = buildPresetsTool({ project: opts.project ?? projectOf() });
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
    expect(project.presets?.map(item => item.spec)).toEqual(['ignis', 'file:../acme-web']);
    expect(project.packages.find(item => item.dir === 'money')?.kind).toBe('lib');
  });

  test('a manifest without them reads as none', () => {
    const project = projectOf({ manifest: { schemaVersion: 1, name: 'bare' } });

    expect(project.layout).toBeUndefined();
    expect(project.presets).toBeUndefined();
  });
});

describe('presets (kind app)', () => {
  test('lists each recorded preset with its folder and the exact command', async () => {
    const answer = await ask({ args: { name: 'api3' } });

    expect(answer.kind).toBe('app');
    expect(answer.presets).toEqual([
      {
        preset: 'ignis',
        side: 'backend',
        summary: 'An IGNIS API on Bun.',
        folder: 'services',
        command: 'bun x --no-install vulcan add --preset ignis --app api3',
      },
      {
        preset: 'file:../acme-web',
        side: 'frontend',
        summary: 'An admin.',
        folder: 'web',
        command:
          'bun x --no-install vulcan add --preset file:../acme-web --app api3 --api <backend app> | --no-api',
      },
    ]);
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

  test('side narrows the list', async () => {
    const answer = await ask({ args: { side: 'frontend' } });

    expect(answer.presets.map((item: { preset: string }) => item.preset)).toEqual([
      'file:../acme-web',
    ]);
  });
});

describe('presets (kind lib)', () => {
  test('only the presets that make a library, with the shared folder', async () => {
    const answer = await ask({ args: { kind: 'lib', name: 'billing' } });

    expect(answer.kind).toBe('lib');
    expect(answer.presets).toEqual([
      {
        preset: 'ignis',
        summary: 'An IGNIS library.',
        folder: 'libs',
        command: 'bun x --no-install vulcan add --preset ignis --lib billing',
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

  test('a project whose presets make no library says so, and gives no command', async () => {
    const project = projectOf({
      manifest: { ...MANIFEST, presets: [{ spec: 'ignis', side: 'backend', summary: 'An API.' }] },
    });
    const answer = await ask({ project, args: { kind: 'lib', name: 'billing' } });

    expect(answer.presets).toEqual([]);
    expect(answer.note).toBe(
      'no recorded preset makes a lib: ask the user which preset to use, or how it should be made; do not hand-write package.json, tsconfig or scripts, and do not use an app preset for it',
    );
  });
});

describe('presets (nothing fits)', () => {
  test('a kind no preset makes is said plainly, never pointed at an app preset', async () => {
    for (const kind of ['feature', 'tool', 'service']) {
      const answer = await ask({ args: { kind } });

      expect(answer.presets).toEqual([]);
      expect(answer.note).toBe(
        `no preset makes a ${kind} (vulcan add makes apps and libs): ask the user how it should be made; do not hand-write package.json, tsconfig or scripts, and do not use an app or lib preset for it`,
      );
    }
  });

  test('a project that recorded no preset says so and gives the form, not a command', async () => {
    const answer = await ask({
      project: projectOf({ manifest: { schemaVersion: 1, name: 'bare' } }),
    });

    expect(answer.presets).toEqual([]);
    expect(answer.note).toBe(
      'this project has no recorded preset: ask the user which preset to use; the form is `vulcan add --preset <name|file:path> --app <name>` (--lib <name> for a shared package)',
    );
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
