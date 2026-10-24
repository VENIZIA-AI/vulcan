import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadGeneration } from '../../generate/registry.ts';
import { listPackages } from '../../source/index.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const APP = join(import.meta.dir, '..', 'fixtures', 'private-app');

// An application: private packages outside packages/, a retired one with no directory left.
const useApp = (opts: { okf?: object }): void => {
  useProjectConfig({
    root: APP,
    config: {
      packages: [
        { dir: 'web', name: '@nx/web', path: 'apps/web', aliases: [], retired: false },
        { dir: 'kit', name: '@nx/kit', path: 'umbras/kit', aliases: [], retired: false },
        { dir: 'gone', name: '@nx/gone', path: 'umbras/gone', aliases: [], retired: true },
      ],
      knowledge: { bundle: 'docs/knowledge' },
      okf: opts.okf ?? {},
    },
  });
};

test('the configured live packages, by directory name, wherever they live', () => {
  useApp({});

  expect(listPackages()).toEqual([
    { dir: 'kit', path: join(APP, 'umbras/kit') },
    { dir: 'web', path: join(APP, 'apps/web') },
  ]);
});

test('no configured packages: every directory under packages/', () => {
  useProjectConfig({ root: join(import.meta.dir, '..', 'fixtures', 'sources'), config: {} });

  expect(listPackages().map((entry) => entry.dir)).toEqual(['admin', 'kernel', 'react']);
});

test('the packages table and the source map read each package where it lives', async () => {
  useApp({
    okf: {
      renderers: ['source-map'],
      regions: [{ id: 'packages-table', file: 'overview/layout.md', renderer: 'packages-table' }],
    },
  });
  const { renderers, regions } = await loadGeneration();
  const [sourceMap] = renderers;
  const map = [
    sourceMap.renderer.render?.({
      context: sourceMap.context,
      facts: sourceMap.renderer.collect({ context: sourceMap.context }),
    }),
  ].flat()[0];

  expect(regions[0].render()).toContain(
    '| [`kit`](/packages/kit.md) | `@nx/kit` | The design kit. |',
  );
  expect(map?.content).toContain('## kit  (2 source files)');
  expect(map?.content).toContain('| `ui/` | 2 |');
});
