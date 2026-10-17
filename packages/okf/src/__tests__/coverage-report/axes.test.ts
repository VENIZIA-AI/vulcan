import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectCoverageAxes } from '../../coverage-report/axes.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const ROOT = join(import.meta.dir, '..', 'fixtures', 'sources');

test('an axis lists the directories its path matches, minus the denylist, in name order', () => {
  useProjectConfig({
    root: ROOT,
    config: { okf: { coverage: [{ name: 'packages', path: 'packages/*' }], denylist: ['react'] } },
  });

  expect(collectCoverageAxes()).toEqual([{ name: 'packages', items: ['admin', 'kernel'] }]);
});

test('no okf.coverage: no axis', () => {
  useProjectConfig({ root: ROOT, config: {} });

  expect(collectCoverageAxes()).toEqual([]);
});

test('a coverage axis whose path matches nothing fails, naming the axis', () => {
  useProjectConfig({
    root: ROOT,
    config: { okf: { coverage: [{ name: 'apps', path: 'apps/*' }] } },
  });

  expect(() => collectCoverageAxes()).toThrow(
    "okf: coverage axis 'apps' matches no directory (apps/*)",
  );
});
