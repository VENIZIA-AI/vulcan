import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { resolveSources } from '@/sources';
import {
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previous = { registry: process.env.VULCAN_NPM_REGISTRY };

let cacheDir: string;

beforeEach(() => {
  cacheDir = makeTempDirectory({ prefix: 'atlas-cache-' });
});

afterEach(() => {
  if (previous.registry === undefined) {
    delete process.env.VULCAN_NPM_REGISTRY;
  } else {
    process.env.VULCAN_NPM_REGISTRY = previous.registry;
  }
});

/** A registry with @x/kernel 1.0.0 - the version the source's tag released. */
const serveKernel = () => {
  const packed = makeTempDirectory({ prefix: 'atlas-tarball-' });
  const files: Record<string, string> = {
    'package/package.json': JSON.stringify({
      name: '@x/kernel',
      version: '1.0.0',
      exports: { '.': { types: './index.d.ts' } },
    }),
    'package/index.d.ts': 'export declare function boot(): void;\n',
  };

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(packed, path)), { recursive: true });
    writeFileSync(join(packed, path), text);
  }

  execFileSync('tar', ['-czf', join(packed, 'kernel-1.0.0.tgz'), '-C', packed, 'package']);

  return Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/@x/kernel/-/kernel-1.0.0.tgz'
        ? new Response(Bun.file(join(packed, 'kernel-1.0.0.tgz')))
        : new Response('not found', { status: 404 }),
  });
};

const symbolOf = async (opts: {
  cwd: string;
  name: string;
  sources: Parameters<typeof resolveSources>[0]['sources'];
}) => {
  const resolved = await resolveSources({ cwd: opts.cwd, cacheDir, sources: opts.sources });

  // A start from cache asks npm again in the background; the answer waits for it here.
  await Promise.all(resolved.map((source) => source.symbolsPending ?? Promise.resolve()));

  const reply = JSON.parse(
    (await buildSourcesServer({ sources: resolved, cwd: opts.cwd, version: '0.0.0' }).handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'symbol', arguments: { name: opts.name } },
      }),
    })) ?? 'null',
  );

  return reply;
};

test("a source's package nobody installed answers from the npm tarball of its newest release", async () => {
  const source = makeSourceRepository();
  const registry = serveKernel();

  process.env.VULCAN_NPM_REGISTRY = `http://localhost:${registry.port}`;

  try {
    const reply = await symbolOf({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      name: 'boot',
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result.content[0].text).toContain('@x/kernel');
    expect(reply.result.content[0].text).toContain('"source":"src"');
  } finally {
    await registry.stop(true);
  }
});

test('a package npm does not have (a private one) leaves the pull whole and says why', async () => {
  const source = makeSourceRepository();
  const registry = Bun.serve({ port: 0, fetch: () => new Response('not found', { status: 404 }) });

  process.env.VULCAN_NPM_REGISTRY = `http://localhost:${registry.port}`;

  try {
    const reply = await symbolOf({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      name: 'boot',
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    expect(reply.error.message).toContain('src: none of its packages is installed here or on npm');
  } finally {
    await registry.stop(true);
  }
});

test('npm down at the pull: the failure is logged, and the next start fetches the symbols again', async () => {
  const source = makeSourceRepository();
  const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
  const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;

  try {
    await resolveSources({ cwd, cacheDir, sources });

    // Must run before `mockRestore()`: restoring a spy also clears its recorded calls.
    expect(errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
      'no symbols for @x/kernel@1.0.0',
    );
  } finally {
    errorSpy.mockRestore();
  }

  const registry = serveKernel();

  process.env.VULCAN_NPM_REGISTRY = `http://localhost:${registry.port}`;

  try {
    const reply = await symbolOf({ cwd, name: 'boot', sources });

    expect(reply.error).toBeUndefined();
    expect(reply.result.content[0].text).toContain('@x/kernel');
  } finally {
    await registry.stop(true);
  }
});

test('a registry that stalls never holds up a start from cache', async () => {
  const source = makeSourceRepository();
  const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
  const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);

  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;

  try {
    await resolveSources({ cwd, cacheDir, sources });

    // Accepts and never answers.
    const stalled = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => undefined) });

    process.env.VULCAN_NPM_REGISTRY = `http://localhost:${stalled.port}`;

    const startedAt = performance.now();
    const [resolved] = await resolveSources({ cwd, cacheDir, sources });

    expect(performance.now() - startedAt).toBeLessThan(5_000);
    expect(resolved.symbolsPending).toBeDefined();

    await stalled.stop(true);
  } finally {
    errorSpy.mockRestore();
  }
}, 30_000);
