import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigLoader } from '../../config/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const PLAIN_CONFIG = "export default { agents: ['claude'], rules: { 'V-W-01': 'read-only' } };\n";

describe('ConfigLoader.findFile', () => {
  test('finds nothing in an empty directory', () => {
    expect(ConfigLoader.findFile({ root: createProject({ files: {} }) })).toBeUndefined();
  });

  test('finds .configs/vulcan.config.mts', () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': PLAIN_CONFIG } });

    expect(ConfigLoader.findFile({ root })).toBe(join(root, '.configs/vulcan.config.mts'));
  });

  test.each(['ts', 'mjs', 'js'])('a .%s config is not a config file', (extension) => {
    const root = createProject({
      files: { [`.configs/vulcan.config.${extension}`]: PLAIN_CONFIG },
    });

    expect(ConfigLoader.findFile({ root })).toBeUndefined();
  });
});

describe('ConfigLoader.load', () => {
  test('loads the .mts config and applies the defaults', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': PLAIN_CONFIG } });
    const result = await ConfigLoader.load({ root });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.config.agents).toEqual(['claude']);
      expect(result.config.knowledge.bundle).toBe('.agents/knowledge');
      expect(result.config.hooks).toEqual([]);
    }
  });

  test('a .ts config is not read: the error names the one file a project has', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.ts': PLAIN_CONFIG } });

    const result = await ConfigLoader.load({ root });

    expect(result).toEqual({
      ok: false,
      error: `no .configs/vulcan.config.mts found in ${root}`,
    });
  });

  test('no config: the error names the directory', async () => {
    const root = createProject({ files: {} });

    const result = await ConfigLoader.load({ root });
    expect(result).toEqual({
      ok: false,
      error: `no .configs/vulcan.config.mts found in ${root}`,
    });
  });

  test('an unknown key: the error names the file and the key', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': 'export default { agentz: [] };\n' },
    });
    const result = await ConfigLoader.load({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('.configs/vulcan.config.mts');
      expect(result.error).toContain('agentz');
    }
  });

  test('a wrong type: the error names the field path', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': "export default { agents: 'claude' };\n" },
    });
    const result = await ConfigLoader.load({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('agents');
    }
  });

  test('an unknown agent kind is rejected', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': "export default { agents: ['notepad'] };\n" },
    });

    const result = await ConfigLoader.load({ root });
    expect(result.ok).toBe(false);
  });

  test('a config that throws on import is reported with its file', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': "throw new Error('boom');\n" },
    });
    const result = await ConfigLoader.load({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('.configs/vulcan.config.mts');
      expect(result.error).toContain('boom');
    }
  });

  test('a missing default export is reported', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': 'export const x = 1;\n' },
    });
    const result = await ConfigLoader.load({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('default export');
    }
  });

  test('a default export that is not an object is reported', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': 'export default () => ({});\n' },
    });

    const result = await ConfigLoader.load({ root });
    expect(result.ok).toBe(false);
  });
});
