import { afterAll, describe, expect, test } from 'bun:test';
import { findConfigFiles, loadConfig } from '../../config/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const PLAIN_CONFIG = "export default { agents: ['claude'], rules: { 'V-W-01': 'read-only' } };\n";

describe('findConfigFiles', () => {
  test('finds nothing in an empty directory', () => {
    expect(findConfigFiles({ root: createProject({ files: {} }) })).toEqual([]);
  });

  test('lists every candidate in lookup order ts, mts, mjs, js', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.js': PLAIN_CONFIG,
        '.configs/vulcan.config.ts': PLAIN_CONFIG,
      },
    });

    expect(findConfigFiles({ root }).map((file) => file.split('/').pop())).toEqual([
      'vulcan.config.ts',
      'vulcan.config.js',
    ]);
  });
});

describe('loadConfig', () => {
  for (const extension of ['ts', 'mts', 'mjs', 'js']) {
    test(`loads a .${extension} config and applies the defaults`, async () => {
      const root = createProject({
        files: { [`.configs/vulcan.config.${extension}`]: PLAIN_CONFIG },
      });
      const result = await loadConfig({ root });

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.config.agents).toEqual(['claude']);
        expect(result.config.knowledge.bundle).toBe('.agents/knowledge');
        expect(result.config.hooks).toEqual([]);
      }
    });
  }

  test('no config: the error names the directory', async () => {
    const root = createProject({ files: {} });

    const result = await loadConfig({ root });
    expect(result).toEqual({
      ok: false,
      error: `no .configs/vulcan.config.* found in ${root}`,
    });
  });

  test('two configs: the error names both files', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': PLAIN_CONFIG,
        '.configs/vulcan.config.mjs': PLAIN_CONFIG,
      },
    });
    const result = await loadConfig({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('vulcan.config.ts');
      expect(result.error).toContain('vulcan.config.mjs');
    }
  });

  test('an unknown key: the error names the file and the key', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': 'export default { agentz: [] };\n' },
    });
    const result = await loadConfig({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('.configs/vulcan.config.ts');
      expect(result.error).toContain('agentz');
    }
  });

  test('a wrong type: the error names the field path', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': "export default { agents: 'claude' };\n" },
    });
    const result = await loadConfig({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('agents');
    }
  });

  test('an unknown agent kind is rejected', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': "export default { agents: ['notepad'] };\n" },
    });

    const result = await loadConfig({ root });
    expect(result.ok).toBe(false);
  });

  test('a config that throws on import is reported with its file', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': "throw new Error('boom');\n" },
    });
    const result = await loadConfig({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('.configs/vulcan.config.ts');
      expect(result.error).toContain('boom');
    }
  });

  test('a missing default export is reported', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.ts': 'export const x = 1;\n' } });
    const result = await loadConfig({ root });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('default export');
    }
  });

  test('a default export that is not an object is reported', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': 'export default () => ({});\n' },
    });

    const result = await loadConfig({ root });
    expect(result.ok).toBe(false);
  });
});
