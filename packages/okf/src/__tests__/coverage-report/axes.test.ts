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
    axes: [
      {
        name: 'packages',
        items: ['admin', 'kernel'],
        paths: { admin: 'packages/admin', kernel: 'packages/kernel' },
      },
    ],
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
    axes: [
      {
        name: 'packages',
        items: ['admin', 'kernel', 'react'],
        paths: { admin: 'packages/admin', kernel: 'packages/kernel', react: 'packages/react' },
      },
    ],
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

test('an axis exclude drops the directories its globs match, by path from the root', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      okf: { coverage: [{ name: 'packages', path: 'packages/*', exclude: ['packages/react'] }] },
    },
  });

  const { axes } = collectCoverageAxes();

  expect(axes[0]?.items).toEqual(['admin', 'kernel']);
  expect(axes[0]?.paths).toEqual({ admin: 'packages/admin', kernel: 'packages/kernel' });
});

test('an exclude glob matches like the path glob: braces and stars', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      okf: {
        coverage: [{ name: 'packages', path: 'packages/*', exclude: ['packages/{admin,re*}'] }],
      },
    },
  });

  expect(collectCoverageAxes().axes[0]?.items).toEqual(['kernel']);
});

test('a denylist on one axis leaves the other axes alone', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      okf: {
        coverage: [
          { name: 'filtered', path: 'packages/*', denylist: ['react'] },
          { name: 'whole', path: 'packages/*' },
        ],
      },
    },
  });

  const { axes } = collectCoverageAxes();

  expect(axes.map(axis => [axis.name, axis.items])).toEqual([
    ['filtered', ['admin', 'kernel']],
    ['whole', ['admin', 'kernel', 'react']],
  ]);
});

test('the global denylist still applies to every axis', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      okf: { coverage: [{ name: 'packages', path: 'packages/*' }], denylist: ['kernel'] },
    },
  });

  expect(collectCoverageAxes().axes[0]?.items).toEqual(['admin', 'react']);
});

test('an axis whose exclude removes every directory is a problem, not a silent pass', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      okf: { coverage: [{ name: 'packages', path: 'packages/*', exclude: ['packages/*'] }] },
    },
  });

  expect(collectCoverageAxes()).toEqual({
    axes: [],
    problems: [
      "coverage: axis 'packages' (packages/*) has no directory left after exclude/denylist",
    ],
  });
});
