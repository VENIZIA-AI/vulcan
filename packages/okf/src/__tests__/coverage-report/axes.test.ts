import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectCoverageAxes } from '../../coverage-report/axes.ts';
import { coverage } from '../../coverage-report/command.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const ROOT = join(import.meta.dir, '..', 'fixtures', 'sources');

test('an axis lists the directories its path matches, minus the denylist, in name order', () => {
  useProjectConfig({
    root: ROOT,
    config: { okf: { coverage: [{ name: 'packages', path: 'packages/*' }], denylist: ['react'] } },
  });

  expect(collectCoverageAxes()).toEqual({
    axes: [{ name: 'packages', items: ['admin', 'kernel'] }],
    problems: [],
  });
});

test('no okf.coverage: no axis', () => {
  useProjectConfig({ root: ROOT, config: {} });

  expect(collectCoverageAxes()).toEqual({ axes: [], problems: [] });
});

test('an axis whose path matches nothing is a problem naming it, and the other axes still count', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      okf: {
        coverage: [
          { name: 'apps', path: 'apps/*' },
          { name: 'packages', path: 'packages/*' },
        ],
      },
    },
  });

  expect(collectCoverageAxes()).toEqual({
    axes: [{ name: 'packages', items: ['admin', 'kernel', 'react'] }],
    problems: ["coverage: axis 'apps' (apps/*) matches no directory"],
  });
});

test('okf coverage itself still fails on an axis that matches nothing', () => {
  useProjectConfig({
    root: ROOT,
    config: { okf: { coverage: [{ name: 'apps', path: 'apps/*' }] } },
  });

  expect(coverage()).rejects.toThrow("okf: coverage: axis 'apps' (apps/*) matches no directory");
});
