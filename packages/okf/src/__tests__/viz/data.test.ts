import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Concept } from '../../lib.ts';
import { buildVizData } from '../../viz/builder.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

const makeConcept = (opts: { id: string; links?: string[]; reserved?: boolean }): Concept => ({
  id: opts.id,
  file: `/repo/.agents/knowledge${opts.id}.md`,
  type: 'Concept',
  title: opts.id.split('/').pop() ?? opts.id,
  description: `about ${opts.id}`,
  resource: `src${opts.id}.ts`,
  tags: ['t'],
  body: 'body',
  raw: '',
  links: opts.links ?? [],
  reserved: opts.reserved ?? false,
});

// The section order is project config; this one mirrors a typical bundle.
beforeEach(() => {
  useProjectConfig({
    root: '/project',
    config: { okf: { sections: { order: ['overview', 'architecture', 'packages'], labels: {} } } },
  });
});

afterEach(clearProjectConfig);

describe('buildVizData', () => {
  test('counts each undirected link once per end, skipping self, dangling and duplicate links', () => {
    const data = buildVizData({
      concepts: [
        makeConcept({
          id: '/packages/a',
          links: ['/packages/b', '/packages/b', '/packages/a', '/nowhere'],
        }),
        makeConcept({ id: '/packages/b', links: ['/packages/a'] }),
      ],
    });

    expect(data.edges).toEqual([
      { source: '/packages/a', target: '/packages/b' },
      { source: '/packages/b', target: '/packages/a' },
    ]);
    expect(data.nodes.map((node) => node.degree)).toEqual([2, 2]);
  });

  test('reserved files (index.md, log.md) are not nodes', () => {
    const data = buildVizData({
      concepts: [makeConcept({ id: '/index', reserved: true }), makeConcept({ id: '/packages/a' })],
    });

    expect(data.nodes.map((node) => node.id)).toEqual(['/packages/a']);
  });

  test('sections follow the configured order, unknown sections after them in name order', () => {
    const data = buildVizData({
      concepts: [
        makeConcept({ id: '/zeta/x' }),
        makeConcept({ id: '/packages/a' }),
        makeConcept({ id: '/alpha-beta/y' }),
        makeConcept({ id: '/overview/o' }),
      ],
    });

    expect(data.sections.map((section) => section.key)).toEqual([
      'overview',
      'packages',
      'alpha-beta',
      'zeta',
    ]);
    expect(data.sections.find((section) => section.key === 'alpha-beta')?.label).toBe('Alpha Beta');
  });

  test('a node carries its resource, so the reader can show its source', () => {
    expect(buildVizData({ concepts: [makeConcept({ id: '/packages/a' })] }).nodes[0].resource).toBe(
      'src/packages/a.ts',
    );
  });
});
