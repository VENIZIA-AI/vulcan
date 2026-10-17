import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readOkfProject } from '../../project/index.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const ROOT = '/work/project';

test('paths come back absolute, regions under the bundle, outputs under the root', () => {
  useProjectConfig({
    root: ROOT,
    config: {
      knowledge: { bundle: '.agents/knowledge' },
      packages: [{ dir: 'kernel', name: '@a/kernel', aliases: [], retired: false }],
      okf: {
        regions: [{ id: 'r', file: 'overview/x.md', renderer: 'packages-table' }],
        denylist: ['template'],
        viz: { outputs: ['.agents/knowledge/viz.html', 'docs/graph.html'] },
      },
    },
  });
  const project = readOkfProject();

  expect(project.root).toBe(ROOT);
  expect(project.bundle).toBe(join(ROOT, '.agents/knowledge'));
  expect(project.regions[0].file).toBe(join(ROOT, '.agents/knowledge/overview/x.md'));
  expect(project.viz.outputs).toEqual([
    join(ROOT, '.agents/knowledge/viz.html'),
    join(ROOT, 'docs/graph.html'),
  ]);
  expect(project.denylist.has('template')).toBe(true);
  expect(project.packages).toEqual([{ dir: 'kernel', name: '@a/kernel', retired: false }]);
});

test('missing sections take the schema defaults: nothing selected, the default viz output', () => {
  useProjectConfig({ root: ROOT, config: {} });
  const project = readOkfProject();

  expect(project.renderers).toEqual([]);
  expect(project.regions).toEqual([]);
  expect(project.coverage).toEqual([]);
  expect(project.sections).toEqual({ order: [], labels: {} });
  expect(project.viz.outputs).toEqual([join(ROOT, '.agents/knowledge/viz.html')]);
});

test('the brand defaults to the root package name without scope and -workspace, upper-cased', () => {
  useProjectConfig({ root: join(import.meta.dir, '..', 'fixtures', 'branded'), config: {} });

  expect(readOkfProject().viz.brand).toBe('ACME');
});

test('outside vulcan x it stops with what to do', () => {
  expect(() => readOkfProject()).toThrow('okf: no project config - run through `vulcan x okf`');
});

test('one read per process: the same handoff gives back the same project', () => {
  useProjectConfig({ root: ROOT, config: {} });
  const first = readOkfProject();

  expect(readOkfProject()).toBe(first);

  useProjectConfig({ root: '/another/project', config: {} });

  expect(readOkfProject().root).toBe('/another/project');
});
