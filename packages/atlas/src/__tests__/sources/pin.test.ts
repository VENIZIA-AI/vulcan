import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { resolveSources } from '@/sources';
import type { IAtlasSource } from '@/sources';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  SOURCE_MANIFEST,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let cacheDir: string;

beforeEach(() => {
  cacheDir = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  delete process.env.VULCAN_NPM_REGISTRY;
});

const FORGE_PAGE =
  '---\ntype: Concept\ntitle: Forge\ndescription: The forge.\n---\n\nThe forge is new in 1.1.0.\n';

/**
 * kernel-v1.0.0 is the first commit. The second commit adds the forge page and tags helpers-v0.5.0
 * (the manifest then declares `@x/helpers`). The third tags kernel-v1.1.0. develop is the third.
 */
const releasedSource = () => {
  const source = makeSourceRepository();
  const manifest = JSON.parse(SOURCE_MANIFEST);

  manifest.packages.push({
    name: '@x/helpers',
    dir: 'helpers',
    path: 'packages/helpers',
    aliases: [],
    retired: false,
  });
  writeSourceFile({
    work: source.work,
    path: '.agents/vulcan.manifest.json',
    text: `${JSON.stringify(manifest, null, 2)}\n`,
  });
  writeSourceFile({
    work: source.work,
    path: '.agents/knowledge/overview/forge.md',
    text: FORGE_PAGE,
  });
  commitAll({ work: source.work, message: 'chore(helpers): release v0.5.0' });
  git({ cwd: source.work, args: ['tag', 'helpers-v0.5.0'] });
  writeSourceFile({ work: source.work, path: 'docs/notes.md', text: 'a later release\n' });
  commitAll({ work: source.work, message: 'chore(kernel): release v1.1.0' });
  git({ cwd: source.work, args: ['tag', 'kernel-v1.1.0'] });
  git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop', '--tags'] });

  return source;
};

/** A consumer whose node_modules holds each package at a version; `linked` ones are symlinks, as a workspace or file: gives. */
const consumerWith = (opts: { installed?: Record<string, string>; linked?: string[] }): string => {
  const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });

  for (const [name, version] of Object.entries(opts.installed ?? {})) {
    const target = opts.linked?.includes(name)
      ? join(makeTempDirectory({ prefix: 'atlas-linked-' }), 'pkg')
      : join(cwd, 'node_modules', name);

    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name, version }));

    if (opts.linked?.includes(name)) {
      mkdirSync(join(cwd, 'node_modules', name, '..'), { recursive: true });
      symlinkSync(target, join(cwd, 'node_modules', name));
    }
  }

  return cwd;
};

/** A consumer monorepo: its manifest declares the app `apps/api`, and the packages are installed under that app, not the root. */
const workspaceConsumerWith = (opts: { installed: Record<string, string> }): string => {
  const cwd = makeTempDirectory({ prefix: 'atlas-workspace-' });

  writeSourceFile({
    work: cwd,
    path: '.agents/vulcan.manifest.json',
    text: `${JSON.stringify({
      schemaVersion: 1,
      name: 'consumer',
      packages: [{ name: 'api', dir: 'api', path: 'apps/api', aliases: [], retired: false }],
      knowledge: { bundle: '.agents/knowledge' },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    })}\n`,
  });
  writeSourceFile({
    work: cwd,
    path: '.agents/knowledge/index.md',
    text: '---\ntype: Concept\ntitle: Consumer\ndescription: The consumer.\n---\n\nThe consumer.\n',
  });

  for (const [name, version] of Object.entries(opts.installed)) {
    const target = join(cwd, 'apps/api/node_modules', name);

    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name, version }));
  }

  return cwd;
};

const serve = async (opts: { cwd: string; source: IAtlasSource; refreshMs?: number }) => {
  const sources = await resolveSources({ cwd: opts.cwd, cacheDir, sources: [opts.source] });
  const transport = buildSourcesServer({
    sources,
    cwd: opts.cwd,
    version: '0.0.0',
    ...(opts.refreshMs === undefined ? {} : { refresh: { intervalMs: opts.refreshMs } }),
  });

  return { sources, transport };
};

const call = async (opts: {
  transport: ReturnType<typeof buildSourcesServer>;
  name: string;
  args?: Record<string, unknown>;
}) => {
  const reply = JSON.parse(
    (await opts.transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: opts.name, arguments: opts.args ?? {} },
      }),
    })) ?? 'null',
  );

  return JSON.parse(reply.result.content[0].text);
};

const instructionsOf = async (opts: { transport: ReturnType<typeof buildSourcesServer> }) =>
  JSON.parse(
    (await opts.transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    })) ?? 'null',
  ).result.instructions as string;

const forgeHits = async (opts: { transport: ReturnType<typeof buildSourcesServer> }) =>
  (await call({ transport: opts.transport, name: 'search', args: { query: 'forge' } })).total;

const eventually = async (opts: { read: () => Promise<unknown>; expected: unknown }) => {
  let last: unknown;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    last = await opts.read();

    if (JSON.stringify(last) === JSON.stringify(opts.expected)) {
      return last;
    }

    await Bun.sleep(50);
  }

  return last;
};

const SRC = (opts: { url: string; pin?: 'installed' | 'ref' }): IAtlasSource => ({
  name: 'src',
  repo: opts.url,
  ref: 'develop',
  ...(opts.pin === undefined ? {} : { pin: opts.pin }),
});

describe('a source is served at the version the project has installed', () => {
  test('kernel 1.0.0 installed: the docs are the tag of 1.0.0, the release table still knows 1.1.0', async () => {
    const source = releasedSource();
    const { sources, transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '1.0.0' } }),
      source: SRC({ url: source.url }),
    });

    // The forge page was added after kernel-v1.0.0.
    expect(await forgeHits({ transport })).toBe(0);
    expect(sources[0].origin).toContain('kernel-v1.0.0');
    expect((await call({ transport, name: 'version' })).snapshot['@x/kernel']).toBe('1.1.0');
  });

  test('kernel 1.1.0 installed: the docs are the tag of 1.1.0', async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '1.1.0' } }),
      source: SRC({ url: source.url }),
    });

    expect(await forgeHits({ transport })).toBe(1);
  });

  test('two packages installed: the newest release among them decides, and the status says which', async () => {
    const source = releasedSource();
    // helpers-v0.5.0 is a later commit than kernel-v1.0.0: its tag is the newer thing the project runs.
    const { transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '1.0.0', '@x/helpers': '0.5.0' } }),
      source: SRC({ url: source.url }),
    });
    const text = await instructionsOf({ transport });

    expect(await forgeHits({ transport })).toBe(1);
    expect(text).toContain('helpers-v0.5.0');
    expect(text).toContain('@x/helpers 0.5.0');
  });

  test('nothing installed: the ref is served, and the status says why', async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: consumerWith({}),
      source: SRC({ url: source.url }),
    });
    const text = await instructionsOf({ transport });

    expect(await forgeHits({ transport })).toBe(1);
    expect(text).toContain('develop');
    expect(text).toContain('none of its packages is installed');
  });

  test("a package installed under a workspace app's node_modules is the installed one", async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: workspaceConsumerWith({ installed: { '@x/kernel': '1.0.0' } }),
      source: SRC({ url: source.url }),
    });
    const text = await instructionsOf({ transport });

    expect(await forgeHits({ transport })).toBe(0);
    expect(text).toContain('kernel-v1.0.0');
  });

  test('a linked package (file: or a workspace) is not a release: the ref is served', async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '1.0.0' }, linked: ['@x/kernel'] }),
      source: SRC({ url: source.url }),
    });
    const text = await instructionsOf({ transport });

    expect(await forgeHits({ transport })).toBe(1);
    expect(text).toContain('linked');
  });

  test('an installed version with no recorded release falls back to the ref', async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '0.9.0' } }),
      source: SRC({ url: source.url }),
    });
    const text = await instructionsOf({ transport });

    expect(await forgeHits({ transport })).toBe(1);
    expect(text).toContain('no release of @x/kernel 0.9.0');
  });

  test("pin: 'ref' keeps serving the ref whatever is installed", async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '1.0.0' } }),
      source: SRC({ url: source.url, pin: 'ref' }),
    });
    const text = await instructionsOf({ transport });

    expect(await forgeHits({ transport })).toBe(1);
    expect(text).toContain('pin is ref');
  });

  test('the status line names the tag served and the version it comes from', async () => {
    const source = releasedSource();
    const { transport } = await serve({
      cwd: consumerWith({ installed: { '@x/kernel': '1.0.0' } }),
      source: SRC({ url: source.url }),
    });
    const text = await instructionsOf({ transport });

    expect(text).toContain('kernel-v1.0.0');
    expect(text).toContain('installed @x/kernel 1.0.0');
    expect(Buffer.byteLength(text)).toBeLessThan(2048);
  });

  test('an upgrade while the server runs swaps the docs after the refresh interval', async () => {
    const source = releasedSource();
    const cwd = consumerWith({ installed: { '@x/kernel': '1.0.0' } });
    const { transport } = await serve({ cwd, source: SRC({ url: source.url }), refreshMs: 20 });

    expect(await forgeHits({ transport })).toBe(0);

    writeFileSync(
      join(cwd, 'node_modules/@x/kernel/package.json'),
      JSON.stringify({ name: '@x/kernel', version: '1.1.0' }),
    );
    await Bun.sleep(40);

    expect(await eventually({ read: () => forgeHits({ transport }), expected: 1 })).toBe(1);
  });
});
