import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { resolveSources } from '@/sources';
import { makeSourceRepository, makeTempDirectory, TEMP_DIRECTORIES } from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previous = { cache: process.env.XDG_CACHE_HOME, registry: process.env.VULCAN_NPM_REGISTRY };

beforeEach(() => {
  process.env.XDG_CACHE_HOME = makeTempDirectory({ prefix: 'atlas-cache-' });
});

afterEach(() => {
  process.env.XDG_CACHE_HOME = previous.cache;

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
    fetch: request =>
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
  const resolved = await resolveSources({ cwd: opts.cwd, sources: opts.sources });
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
