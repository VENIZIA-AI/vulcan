import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadGeneration } from '../../generate/registry.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

const useRenderers = (opts: { renderers: unknown[]; regions?: unknown[] }): void => {
  useProjectConfig({
    root: FIXTURES,
    config: { okf: { renderers: opts.renderers, regions: opts.regions ?? [] } },
  });
};

test('no okf.renderers and no okf.regions: nothing loads', async () => {
  useProjectConfig({ root: FIXTURES, config: {} });

  expect(await loadGeneration()).toEqual({ renderers: [], regions: [] });
});

test('a built-in id loads with its options', async () => {
  useRenderers({ renderers: [{ id: 'source-map', options: { path: 'reference/map.md' } }] });
  const [loaded] = (await loadGeneration()).renderers;

  expect(loaded.renderer.id).toBe('source-map');
  expect(loaded.context.options.path).toBe('reference/map.md');
});

test('a bare string is the built-in id alone', async () => {
  useRenderers({ renderers: ['makefile-targets'] });
  const [loaded] = (await loadGeneration()).renderers;

  expect(loaded.renderer.id).toBe('makefile-targets');
  expect(loaded.context.options).toEqual({});
});

test('a project module loads by path, its facts feed render and coverage', async () => {
  useRenderers({ renderers: [{ id: 'providers', module: 'project-module/providers.ts' }] });
  const [loaded] = (await loadGeneration()).renderers;
  const facts = loaded.renderer.collect({ context: loaded.context });

  expect([loaded.renderer.render?.({ context: loaded.context, facts })].flat()[0]?.path).toBe(
    'reference/providers.md',
  );
  expect(loaded.renderer.coverage?.({ facts })).toEqual({ name: 'providers', count: 1 });
});

test('a missing module stops with its path', async () => {
  useRenderers({ renderers: [{ id: 'x', module: 'nope/x.ts' }] });

  expect(loadGeneration()).rejects.toThrow('okf: renderer module nope/x.ts not found');
});

test('a module without a defineRenderer default export stops, naming it', async () => {
  useRenderers({ renderers: [{ id: 'providers', module: 'project-module/not-a-renderer.ts' }] });

  expect(loadGeneration()).rejects.toThrow(
    'okf: renderer module project-module/not-a-renderer.ts must default-export defineRenderer({ ... })',
  );
});

test('a module whose id differs from the config entry stops', async () => {
  useRenderers({ renderers: [{ id: 'services', module: 'project-module/providers.ts' }] });

  expect(loadGeneration()).rejects.toThrow(
    "okf: renderer module project-module/providers.ts defines 'providers', the config names 'services'",
  );
});

test('two renderers with one id stop', async () => {
  useRenderers({ renderers: ['source-map', { id: 'source-map', options: { path: 'x.md' } }] });

  expect(loadGeneration()).rejects.toThrow("okf: two renderers with id 'source-map'");
});

test('an unknown built-in id stops with the known ones', async () => {
  useRenderers({ renderers: [{ id: 'components' }] });

  expect(loadGeneration()).rejects.toThrow(
    "okf: 'components' is not a built-in renderer (source-map, makefile-targets, binding-keys, packages-table) - give it a module",
  );
});

test('a region takes its renderer from the built-ins when okf.renderers does not list it', async () => {
  useRenderers({
    renderers: [],
    regions: [{ id: 'packages-table', file: 'overview/layout.md', renderer: 'packages-table' }],
  });
  const { regions } = await loadGeneration();

  expect(regions.map(region => region.id)).toEqual(['packages-table']);
  expect(regions[0].file).toBe(join(FIXTURES, '.agents/knowledge/overview/layout.md'));
});

test('a region whose renderer has no region output stops', async () => {
  useRenderers({
    renderers: [],
    regions: [{ id: 'r', file: 'overview/layout.md', renderer: 'source-map' }],
  });

  expect(loadGeneration()).rejects.toThrow(
    "okf: region 'r' names renderer 'source-map', which renders no region",
  );
});

test('binding-keys without options.source stops when it collects', async () => {
  useRenderers({ renderers: ['binding-keys'] });
  const [loaded] = (await loadGeneration()).renderers;

  expect(() => loaded.renderer.collect({ context: loaded.context })).toThrow(
    'okf: renderer binding-keys needs options.source (the file that declares the keys)',
  );
});

test('binding-keys reads the configured file', async () => {
  useProjectConfig({
    root: join(FIXTURES, 'sources'),
    config: {
      okf: {
        renderers: [
          { id: 'binding-keys', options: { source: 'packages/kernel/src/common/keys.ts' } },
        ],
      },
    },
  });
  const [loaded] = (await loadGeneration()).renderers;
  const facts = loaded.renderer.collect({ context: loaded.context });

  expect(loaded.renderer.coverage?.({ facts })).toEqual({ name: 'binding keys', count: 1 });
  expect(
    [loaded.renderer.render?.({ context: loaded.context, facts })].flat()[0]?.content,
  ).toContain('| `APPLICATION` | `@app/application` |');
});

test('a region with the id contents stops: okf writes the contents list between those markers', async () => {
  useRenderers({
    renderers: [],
    regions: [{ id: 'contents', file: 'overview/layout.md', renderer: 'packages-table' }],
  });

  expect(loadGeneration()).rejects.toThrow(
    "okf: region id 'contents' is reserved for the contents list okf writes - rename the region",
  );
});
