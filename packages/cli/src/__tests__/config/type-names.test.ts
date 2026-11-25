import { describe, expect, test } from 'bun:test';
import { ConfigTypeNames } from '../../config/type-names.ts';

const CONFIG = '.configs/vulcan.config.mts';
const run = (files: Record<string, string>) =>
  ConfigTypeNames.run({ root: process.cwd(), read: (path) => files[path] });

describe('the type-names codemod', () => {
  test('kind and presetKind of a package entry are renamed, in a config with groups', () => {
    const result = run({
      [CONFIG]: `export default {
  project: {
    packages: [
      { dir: 'money', name: '@x/money', kind: 'lib', presetKind: 'shared' },
      { dir: 'api', name: '@x/api' },
    ],
  },
};
`,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changes).toEqual([
      {
        path: CONFIG,
        text: `export default {
  project: {
    packages: [
      { dir: 'money', name: '@x/money', type: 'lib', presetType: 'shared' },
      { dir: 'api', name: '@x/api' },
    ],
  },
};
`,
      },
    ]);
  });

  test('a quoted key keeps its quotes, and the apps block of a module is read', () => {
    const result = run({
      '.configs/vulcan/project.mts': `// vulcan:apps:start
export const apps = [
  { "dir": "kit", "name": "@x/kit", "kind": "lib" },
];
// vulcan:apps:end
`,
    });

    expect(result.ok && result.changes[0]?.text).toContain('"type": "lib"');
  });

  test('a kind of an object that is not a package entry is left alone, and a second run changes nothing', () => {
    const files = {
      [CONFIG]: `export default {
  agent: { digest: { kind: 'x' } },
  project: { packages: [{ dir: 'a', name: '@x/a', kind: 'lib' }] },
};
`,
    };
    const first = run(files);
    const text = first.ok ? first.changes[0]?.text : undefined;

    expect(text).toContain("kind: 'x'");
    expect(text).toContain("type: 'lib'");

    const second = run({ [CONFIG]: text ?? '' });

    expect(second.ok && second.changes).toEqual([]);
  });

  test('no config is nothing to do', () => {
    expect(run({})).toEqual({
      ok: true,
      changes: [],
      notes: ['no kind, presetKind or kinds key to rename: nothing to do'],
    });
  });
});
