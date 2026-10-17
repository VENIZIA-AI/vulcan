import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectHouseProblems } from '../../check/house.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

test('an axis that matches nothing is one problem among the others, never an abort', () => {
  useProjectConfig({
    root: join(import.meta.dir, '..', 'fixtures', 'sources'),
    config: { okf: { coverage: [{ name: 'apps', path: 'apps/*' }] } },
  });

  expect(
    collectHouseProblems({
      files: [{ path: 'overview/x.md', text: 'a — b' }],
      renderers: [],
      regions: [],
    }),
  ).toEqual([
    '.agents/knowledge/overview/x.md: use a hyphen, not an em-dash or en-dash (found "—")',
    "coverage: axis 'apps' (apps/*) matches no directory",
  ]);
});
