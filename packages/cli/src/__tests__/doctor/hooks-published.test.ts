import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { HooksBundle } from '../../sync/hooks-bundle.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = VULCAN_CONFIG_SCHEMA.parse({});
const SUMS = { 'guard-git.js': 'a'.repeat(64), 'guard-outside.js': 'b'.repeat(64) };

const projectWith = (sums: Record<string, string>): string => {
  const root = createProject({ files: {} });

  mkdirSync(join(root, '.agents'), { recursive: true });
  writeFileSync(
    join(root, '.agents', 'vulcan.manifest.json'),
    JSON.stringify({ hooks: { version: '0.5.0', folder: '.agents/local/hooks', sha256: sums } }),
  );

  return root;
};

const check = (root: string) =>
  ProjectContract.checkHooksPublished({ root, config: CONFIG, configFile: '' });

const before = process.env.CI;

afterEach(() => {
  if (before === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = before;
  }
});

describe('the recorded sums against the package the registry published', () => {
  test('in the workspace of VULCAN itself, nothing is compared: the hooks are its own sources', () => {
    process.env.CI = 'true';

    expect(HooksBundle.isInstalled()).toBe(false);
    expect(check(projectWith(SUMS))).toEqual([]);
  });

  test('without CI it does not reach for the network', () => {
    delete process.env.CI;

    const installed = spyOn(HooksBundle, 'isInstalled').mockReturnValue(true);
    const published = spyOn(HooksBundle, 'published').mockReturnValue(undefined);

    try {
      expect(check(projectWith(SUMS))).toEqual([]);
      expect(published).not.toHaveBeenCalled();
    } finally {
      installed.mockRestore();
      published.mockRestore();
    }
  });

  test.each([
    ['the same sums pass', SUMS, []],
    ['a sum that differs is named', { ...SUMS, 'guard-git.js': 'c'.repeat(64) }, ['guard-git.js']],
  ])('an installed package under CI: %s', (_name, recorded, differs) => {
    process.env.CI = 'true';

    const installed = spyOn(HooksBundle, 'isInstalled').mockReturnValue(true);
    const published = spyOn(HooksBundle, 'published').mockReturnValue({
      version: '0.5.0',
      files: SUMS,
    });

    try {
      const found = check(projectWith(recorded));

      expect(published).toHaveBeenCalledWith({ version: '0.5.0' });
      expect(found.length).toBe(differs.length === 0 ? 0 : 1);

      for (const name of differs) {
        expect(found[0]?.message).toContain(name);
        expect(found[0]?.check).toBe('hooks-published');
      }
    } finally {
      installed.mockRestore();
      published.mockRestore();
    }
  });

  test('a published bundle that cannot be read is a failure, not a pass', () => {
    process.env.CI = 'true';

    const installed = spyOn(HooksBundle, 'isInstalled').mockReturnValue(true);
    const published = spyOn(HooksBundle, 'published').mockReturnValue(undefined);

    try {
      const found = check(projectWith(SUMS));

      expect(found.length).toBe(1);
      expect(found[0]?.message).toContain('cannot read the published bundle');
    } finally {
      installed.mockRestore();
      published.mockRestore();
    }
  });

  test('a manifest with no hooks block has nothing to compare', () => {
    process.env.CI = 'true';

    const root = createProject({ files: { '.agents/vulcan.manifest.json': '{}' } });
    const installed = spyOn(HooksBundle, 'isInstalled').mockReturnValue(true);

    try {
      expect(check(root)).toEqual([]);
    } finally {
      installed.mockRestore();
    }
  });
});

describe('the sums file the package ships', () => {
  test('names a path or anything but a bare *.js are dropped, not trusted', () => {
    const parsed = HooksBundle.parseSums({
      text: JSON.stringify({
        version: '0.5.0',
        files: {
          'guard-git.js': 'a'.repeat(64),
          '../evil.js': 'b'.repeat(64),
          'sub/x.js': 'c'.repeat(64),
          'readme.md': 'd'.repeat(64),
        },
      }),
    });

    expect(Object.keys(parsed?.files ?? {})).toEqual(['guard-git.js']);
    expect(HooksBundle.parseSums({ text: 'nope' })).toBeUndefined();
    expect(HooksBundle.parseSums({ text: '[]' })).toBeUndefined();
  });
});
