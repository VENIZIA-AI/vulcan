import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildViz } from '../../viz/builder.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const ROOT = mkdtempSync(join(tmpdir(), 'okf-viz-'));

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

test('every configured output gets the same page, titled with the configured brand', async () => {
  mkdirSync(join(ROOT, '.agents/knowledge/overview'), { recursive: true });
  writeFileSync(
    join(ROOT, '.agents/knowledge/overview/a.md'),
    '---\ntype: Concept\ntitle: A\ndescription: about a\n---\n\nA.\n',
  );
  useProjectConfig({
    root: ROOT,
    config: {
      okf: {
        viz: { outputs: ['.agents/knowledge/viz.html', 'docs/public/graph.html'], brand: 'ACME' },
      },
    },
  });

  await buildViz();

  const first = readFileSync(join(ROOT, '.agents/knowledge/viz.html'), 'utf8');

  expect(readFileSync(join(ROOT, 'docs/public/graph.html'), 'utf8')).toBe(first);
  expect(first).toContain('<title>ACME · Knowledge</title>');
}, 60_000);
