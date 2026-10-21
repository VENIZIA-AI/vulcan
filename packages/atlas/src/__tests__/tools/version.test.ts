import { IGNIS_PACKAGE_MAP } from '../fixtures/ignis-packages';
import { Transport } from '@/protocol';
import { ReleaseStore } from '@/releases';
import type { IReleaseTable } from '@/releases';
import { buildVersionTool } from '@/tools/version.tool';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

const TABLE: IReleaseTable = {
  packageMap: IGNIS_PACKAGE_MAP,
  releases: {
    kernel: [
      { version: '0.2.0-21', date: '2026-09-06', sha: 'aa0644f5' },
      { version: '0.2.0-11', date: '2026-08-20', sha: 'bbbbbbbb' },
    ],
    helpers: [{ version: '0.2.0-15', date: '2026-09-06', sha: 'da8e45c2' }],
  },
  changelogs: [],
};

const releases = new ReleaseStore({ table: TABLE });

// $HOME/.cache, never /tmp: a fixture tree with a node_modules directory must live where the
// developer's own caches live, not on a mount a sandbox may hide or mount noexec.
const CACHE_ROOT = join(homedir(), '.cache');
const directories: string[] = [];

const makeDirectory = (): string => {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const directory = mkdtempSync(join(CACHE_ROOT, 'atlas-version-test-'));

  directories.push(directory);

  return directory;
};

const writeJson = (opts: { file: string; value: unknown }): void => {
  mkdirSync(dirname(opts.file), { recursive: true });
  writeFileSync(opts.file, `${JSON.stringify(opts.value, null, 2)}\n`);
};

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface IVersionPayload {
  installed: Record<string, string | null>;
  snapshot: Record<string, string>;
  behind: { package: string; installed: string; newest: string }[];
}

const callVersion = async (opts: {
  releases: ReleaseStore;
  args: Record<string, unknown>;
}): Promise<{
  error?: { code: number; message: string };
  result?: { content: { type: string; text: string }[] };
}> => {
  const transport = new Transport({
    tools: [buildVersionTool({ releases: opts.releases })],
    serverName: 'atlas-test',
    serverVersion: '0.0.0',
  });
  const reply = await transport.handleLine({
    line: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'version', arguments: opts.args },
    }),
  });

  return JSON.parse(reply ?? 'null');
};

const payloadOf = (reply: { result?: { content: { text: string }[] } }): IVersionPayload =>
  JSON.parse(reply.result?.content[0]?.text ?? '{}');

describe('version tool', () => {
  test('resolves the real installed version out of node_modules, not the declared range', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', dependencies: { '@venizia/ignis-kernel': '^0.2.0-11' } },
    });
    writeJson({
      file: join(cwd, 'node_modules/@venizia/ignis-kernel/package.json'),
      value: { name: '@venizia/ignis-kernel', version: '0.2.0-11' },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed['@venizia/ignis-kernel']).toBe('0.2.0-11');
  });

  test("reads a workspace app's own dependencies and node_modules, where a monorepo installs the framework", async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', workspaces: ['services/*'] },
    });
    writeJson({
      file: join(cwd, '.agents/vulcan.manifest.json'),
      value: {
        schemaVersion: 1,
        name: 'consumer',
        packages: [{ name: 'api', dir: 'api', path: 'services/api', aliases: [], retired: false }],
        knowledge: { bundle: '.agents/knowledge' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });
    writeJson({
      file: join(cwd, 'services/api/package.json'),
      value: { name: 'api', dependencies: { '@venizia/ignis-kernel': 'catalog:' } },
    });
    writeJson({
      file: join(cwd, 'services/api/node_modules/@venizia/ignis-kernel/package.json'),
      value: { name: '@venizia/ignis-kernel', version: '0.2.0-11' },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed['@venizia/ignis-kernel']).toBe('0.2.0-11');
    expect(payload.behind).toEqual([
      { package: '@venizia/ignis-kernel', installed: '0.2.0-11', newest: '0.2.0-21' },
    ]);
  });

  test('names the newest version this table knows, per package', async () => {
    const cwd = makeDirectory();

    writeJson({ file: join(cwd, 'package.json'), value: { name: 'consumer' } });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.snapshot).toEqual({
      '@venizia/ignis-helpers': '0.2.0-15',
      '@venizia/ignis-kernel': '0.2.0-21',
    });
  });

  test('lists a package behind the newest known version, named by its npm name', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', dependencies: { '@venizia/ignis-kernel': '^0.2.0-11' } },
    });
    writeJson({
      file: join(cwd, 'node_modules/@venizia/ignis-kernel/package.json'),
      value: { name: '@venizia/ignis-kernel', version: '0.2.0-11' },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.behind).toEqual([
      { package: '@venizia/ignis-kernel', installed: '0.2.0-11', newest: '0.2.0-21' },
    ]);
  });

  test('a package already on the newest version is not behind', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', devDependencies: { '@venizia/ignis-kernel': '0.2.0-21' } },
    });
    writeJson({
      file: join(cwd, 'node_modules/@venizia/ignis-kernel/package.json'),
      value: { name: '@venizia/ignis-kernel', version: '0.2.0-21' },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.behind).toEqual([]);
  });

  test('a declared range with nothing installed reads null, and is never counted as behind', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', dependencies: { '@venizia/ignis-kernel': '^0.2.0-11' } },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed['@venizia/ignis-kernel']).toBeNull();
    expect(payload.behind).toEqual([]);
  });

  test('a declared exact version with nothing installed is a version, not a range', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', dependencies: { '@venizia/ignis-kernel': '0.2.0-11' } },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed['@venizia/ignis-kernel']).toBe('0.2.0-11');
    expect(payload.behind).toEqual([
      { package: '@venizia/ignis-kernel', installed: '0.2.0-11', newest: '0.2.0-21' },
    ]);
  });

  test("bun's isolated linker: a package only under a dependency's own directory resolves from there", async () => {
    const cwd = makeDirectory();
    const store = join(cwd, 'node_modules/.bun/@venizia+vulcan@0.2.0-0/node_modules/@venizia');

    writeJson({
      file: join(cwd, 'package.json'),
      value: {
        name: 'consumer',
        devDependencies: { '@venizia/vulcan': '0.2.0-0', '@venizia/vulcan-okf': 'workspace:*' },
        overrides: { '@venizia/vulcan-atlas': '^0.2.0-0' },
      },
    });
    writeJson({
      file: join(store, 'vulcan/package.json'),
      value: {
        name: '@venizia/vulcan',
        version: '0.2.0-0',
        dependencies: { '@venizia/vulcan-okf': '0.2.0-0', '@venizia/vulcan-atlas': '0.2.0-0' },
      },
    });
    writeJson({
      file: join(store, 'vulcan-okf/package.json'),
      value: { name: '@venizia/vulcan-okf', version: '0.2.0-0' },
    });
    writeJson({
      file: join(store, 'vulcan-atlas/package.json'),
      value: { name: '@venizia/vulcan-atlas', version: '0.2.0-0' },
    });
    mkdirSync(join(cwd, 'node_modules/@venizia'), { recursive: true });
    symlinkSync(join(store, 'vulcan'), join(cwd, 'node_modules/@venizia/vulcan'));

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed).toEqual({
      '@venizia/vulcan': '0.2.0-0',
      '@venizia/vulcan-atlas': '0.2.0-0',
      '@venizia/vulcan-okf': '0.2.0-0',
    });
  });

  test("npm's nested layout: a package under its dependent's node_modules resolves from there", async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: {
        name: 'consumer',
        devDependencies: { '@venizia/vulcan': '0.2.0-0' },
        overrides: { '@venizia/vulcan-okf': '^0.2.0-0' },
      },
    });
    writeJson({
      file: join(cwd, 'node_modules/@venizia/vulcan/package.json'),
      value: {
        name: '@venizia/vulcan',
        version: '0.2.0-0',
        dependencies: { '@venizia/vulcan-okf': '0.2.0-0' },
      },
    });
    writeJson({
      file: join(cwd, 'node_modules/@venizia/vulcan/node_modules/@venizia/vulcan-okf/package.json'),
      value: { name: '@venizia/vulcan-okf', version: '0.2.0-1' },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed['@venizia/vulcan-okf']).toBe('0.2.0-1');
  });

  test('a pin that is only an override reads what its dependent resolves, never a stale root link', async () => {
    const cwd = makeDirectory();
    const store = join(cwd, 'node_modules/.bun/@venizia+vulcan@0.2.0-1/node_modules/@venizia');

    writeJson({
      file: join(cwd, 'package.json'),
      value: {
        name: 'consumer',
        devDependencies: { '@venizia/vulcan': '0.2.0-1' },
        overrides: { '@venizia/vulcan-okf': '0.2.0-1' },
      },
    });
    writeJson({
      file: join(store, 'vulcan/package.json'),
      value: {
        name: '@venizia/vulcan',
        version: '0.2.0-1',
        dependencies: { '@venizia/vulcan-okf': '0.2.0-1' },
      },
    });
    writeJson({
      file: join(store, 'vulcan-okf/package.json'),
      value: { name: '@venizia/vulcan-okf', version: '0.2.0-1' },
    });
    // Left at the root by an older direct dependency; bun never pruned it.
    writeJson({
      file: join(cwd, 'node_modules/@venizia/vulcan-okf/package.json'),
      value: { name: '@venizia/vulcan-okf', version: '0.1.0-0' },
    });
    symlinkSync(join(store, 'vulcan'), join(cwd, 'node_modules/@venizia/vulcan'));

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed['@venizia/vulcan-okf']).toBe('0.2.0-1');
  });

  test('a pinned transitive dependency installed nowhere is left out, never reported as null', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: {
        name: 'consumer',
        dependencies: { '@venizia/ignis-kernel': '^0.2.0-11' },
        overrides: { '@venizia/ignis-helpers': '^0.2.0-15' },
      },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed).toEqual({ '@venizia/ignis-kernel': null });
  });

  test('a dependency outside the @venizia scope is not reported', async () => {
    const cwd = makeDirectory();

    writeJson({
      file: join(cwd, 'package.json'),
      value: { name: 'consumer', dependencies: { hono: '^4.13.7' } },
    });

    const payload = payloadOf(await callVersion({ releases, args: { cwd } }));

    expect(payload.installed).toEqual({});
  });

  test('a directory with no package.json answers with an empty installed, not an error', async () => {
    const cwd = makeDirectory();

    const reply = await callVersion({ releases, args: { cwd } });
    const payload = payloadOf(reply);

    expect(reply.error).toBeUndefined();
    expect(payload.installed).toEqual({});
    expect(payload.behind).toEqual([]);
  });

  test('a source with no releases says why instead of guessing', async () => {
    const reply = await callVersion({
      releases: new ReleaseStore({
        table: { releases: {}, changelogs: [] },
        emptyReason: 'no releases: no tag matches <dir>-v<version>',
      }),
      args: {},
    });

    expect(reply.error?.code).toBe(-32602);
    expect(reply.error?.message).toBe('no releases: no tag matches <dir>-v<version>');
  });

  test('dated entries with no release still have no versions to compare, and say why', async () => {
    const reply = await callVersion({
      releases: new ReleaseStore({
        table: {
          releases: {},
          changelogs: [
            {
              id: 'changelog:2026-01-02-x',
              file: '2026-01-02-x.md',
              date: '2026-01-02',
              title: 'x',
              packages: [],
              kind: null,
            },
          ],
        },
        emptyReason: 'no release history: src was fetched without git',
      }),
      args: {},
    });

    expect(reply.error?.message).toBe('no release history: src was fetched without git');
  });
});
