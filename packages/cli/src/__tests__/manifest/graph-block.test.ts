import { afterAll, describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });
const render = (config: object): Record<string, unknown> =>
  JSON.parse(ProjectManifest.render({ root, config: VULCAN_CONFIG_SCHEMA.parse(config) }));

describe('graph in the config and the manifest', () => {
  test('the manifest carries what the project sets, where atlas reads it', () => {
    const manifest = render({ graph: { exclude: ['**/*.gen.ts'], aliases: { '@/': 'src/' } } });

    expect(manifest.graph).toEqual({ exclude: ['**/*.gen.ts'], aliases: { '@/': 'src/' } });
  });

  test('a project that sets neither has no graph block', () => {
    expect(render({}).graph).toBeUndefined();
    expect(render({ graph: { aliases: { '@/': 'src/' } } }).graph).toEqual({
      aliases: { '@/': 'src/' },
    });
  });

  test.each([
    [{ aliases: { '@': 'src/' } }, 'an alias prefix ends with a slash'],
    [{ aliases: { '@/': '../src/' } }, 'a folder of the package'],
    [{ aliases: { '@/': '/src/' } }, 'a folder of the package'],
    [{ exclude: [''] }, ''],
  ])('%j is refused', (graph) => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ graph }).success).toBe(false);
  });
});
