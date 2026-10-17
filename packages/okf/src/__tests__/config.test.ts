import { afterEach, expect, test } from 'bun:test';
import { readOkfProject } from '../project/index.ts';
import { clearProjectConfig, useProjectConfig } from './project.helper.ts';

afterEach(clearProjectConfig);

test('okf reads the project root vulcan x hands it, never an IGNIS_ROOT left in the environment', () => {
  process.env.IGNIS_ROOT = '/somewhere/else';
  useProjectConfig({ root: '/the/project', config: {} });

  expect(readOkfProject().root).toBe('/the/project');

  delete process.env.IGNIS_ROOT;
});
