import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { resolveServableSources } from '@/sources';
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

/** A project of its own: a manifest and one concept, served live. */
const makeConsumer = (): string => {
  const work = makeTempDirectory({ prefix: 'atlas-consumer-' });

  writeSourceFile({
    work,
    path: '.agents/vulcan.manifest.json',
    text: SOURCE_MANIFEST.replace('"name": "src"', '"name": "own"'),
  });
  writeSourceFile({
    work,
    path: '.agents/knowledge/overview/lighthouse.md',
    text: '---\ntype: Concept\ntitle: Lighthouse\ndescription: The lighthouse.\n---\n\nThe lighthouse keeper starts the kernel.\n',
  });

  return work;
};

/** A source that exists but has not adopted VULCAN yet: no committed manifest. */
const makeUnadoptedSource = (): string => {
  const bare = join(makeTempDirectory({ prefix: 'atlas-unadopted-bare-' }), 'source.git');
  const work = makeTempDirectory({ prefix: 'atlas-unadopted-work-' });

  mkdirSync(bare);
  git({ cwd: bare, args: ['init', '-q', '--bare', '-b', 'develop'] });
  git({ cwd: work, args: ['init', '-q', '-b', 'develop'] });
  writeSourceFile({ work, path: 'README.md', text: '# not yet\n' });
  commitAll({ work, message: 'chore: start' });
  git({ cwd: work, args: ['push', '-q', bare, 'develop'] });

  return `file://${bare}`;
};

test('a source that cannot be served is reported; the project and the other sources are still served', async () => {
  const cwd = makeConsumer();
  const { resolved, unavailable } = await resolveServableSources({
    cwd,
    cacheDir,
    sources: [
      { name: 'unadopted', repo: makeUnadoptedSource(), ref: 'develop' },
      { name: 'gone', repo: `file://${join(cwd, 'no-such.git')}`, ref: 'develop' },
    ],
  });

  expect(resolved.map((source) => source.name)).toEqual(['own']);
  expect(unavailable.map((entry) => entry.source.name)).toEqual(['unadopted', 'gone']);
  expect(unavailable[0].reason).toContain('.agents/vulcan.manifest.json');

  const server = buildSourcesServer({ sources: resolved, unavailable, cwd, version: '0.0.0' });
  const call = async (opts: { method: string; params: object }) =>
    JSON.parse(
      (await server.handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 1, ...opts }),
      })) ?? 'null',
    );
  const initialized = await call({ method: 'initialize', params: {} });
  const searched = await call({
    method: 'tools/call',
    params: { name: 'search', arguments: { query: 'lighthouse keeper' } },
  });

  // The name never depends on which sources the network let through.
  expect(initialized.result.serverInfo.name).toBe('own-atlas');
  expect(initialized.result.instructions).toContain('- unadopted: UNAVAILABLE');
  expect(initialized.result.instructions).toContain('- gone: UNAVAILABLE');
  expect(JSON.stringify(searched.result)).toContain('okf:overview/lighthouse.md');
});

test('a project served with a reachable source keeps its own name', async () => {
  const cwd = makeConsumer();
  const source = makeSourceRepository();
  const { resolved } = await resolveServableSources({
    cwd,
    cacheDir,
    sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
  });
  const server = buildSourcesServer({ sources: resolved, cwd, version: '0.0.0' });
  const initialized = JSON.parse(
    (await server.handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })) ?? 'null',
  );

  expect(resolved.map((entry) => entry.name)).toEqual(['own', 'src']);
  expect(initialized.result.serverInfo.name).toBe('own-atlas');
});
