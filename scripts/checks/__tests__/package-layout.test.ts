import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const PACKAGES = ['okf', 'atlas', 'cli'];

/** What the root of every package holds, and nothing else; the documented differences are below. `bunfig.toml` holds the `[test] preload` that keeps a bare `bun test` out of the system temp (`@venizia/dev-configs/testing/tmpdir-preload`). */
const COMMON = [
  '.configs',
  'LICENSE.md',
  'Makefile',
  'README.md',
  'bunfig.toml',
  'package.json',
  'src',
  'tsconfig.json',
];
/** cli ships `base/` (the rules, skills, hooks and templates every project inherits); okf and atlas have none. */
const EXTRA: Record<string, string[]> = { cli: ['base'] };
/** What `files` ships besides README.md and LICENSE.md: atlas builds a `dist`, okf and cli ship `src`. */
const PAYLOAD: Record<string, string[]> = {
  okf: ['src'],
  atlas: ['dist'],
  cli: ['src', 'base'],
};
/** The folders under `.configs/`: atlas also builds, so it also has `builders/`. */
const CONFIG_FOLDERS: Record<string, string[]> = {
  okf: ['lints'],
  atlas: ['builders', 'lints'],
  cli: ['lints'],
};

const tracked = (opts: { name: string }): string[] => {
  const result = Bun.spawnSync(['git', 'ls-files', '--', `packages/${opts.name}`], {
    cwd: ROOT,
    stdout: 'pipe',
  });

  return result.stdout
    .toString()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(`packages/${opts.name}/`.length));
};

const manifestOf = (opts: { name: string }) =>
  JSON.parse(readFileSync(join(ROOT, 'packages', opts.name, 'package.json'), 'utf8'));

describe.each(PACKAGES)('the layout of packages/%s', (name) => {
  test('its root holds the common entries plus the documented extras, and nothing else', () => {
    const entries = [...new Set(tracked({ name }).map((path) => path.split('/')[0]))].sort();

    expect(entries).toEqual([...COMMON, ...(EXTRA[name] ?? [])].sort());
  });

  test('no env file and no scripts folder is committed: the test env lives in make, the scripts at the root', () => {
    const paths = tracked({ name });

    expect(paths.filter((path) => path.split('/').some((part) => part.startsWith('.env')))).toEqual(
      [],
    );
    expect(paths.filter((path) => path.startsWith('scripts/'))).toEqual([]);
  });

  test('.configs holds the same folders as the other packages', () => {
    const folders = [
      ...new Set(
        tracked({ name })
          .filter((path) => path.startsWith('.configs/'))
          .map((path) => path.split('/')[1]),
      ),
    ].sort();

    expect(folders).toEqual(CONFIG_FOLDERS[name]);
  });

  test('files is README.md, LICENSE.md, the payload, then the same two exclusions', () => {
    expect(manifestOf({ name }).files).toEqual([
      'README.md',
      'LICENSE.md',
      ...PAYLOAD[name],
      '!**/__tests__',
      '!**/*.tsbuildinfo',
    ]);
  });

  test('every file the tarball lists is committed: a license is never missing', () => {
    for (const entry of ['README.md', 'LICENSE.md']) {
      expect(existsSync(join(ROOT, 'packages', name, entry))).toBe(true);
    }
  });

  test('scripts: force-update and test, plus prepublishOnly where a dist is built', () => {
    const keys = Object.keys(manifestOf({ name }).scripts).sort();

    expect(keys).toEqual(
      name === 'atlas' ? ['force-update', 'prepublishOnly', 'test'] : ['force-update', 'test'],
    );
    expect(manifestOf({ name }).scripts.test).toBe('bun test');
    expect(manifestOf({ name }).scripts['force-update']).toBe(
      'sh ../../scripts/build/force-update.sh',
    );
  });
});

describe('the test environment', () => {
  test('lives in make/test.mk, not in a committed file', () => {
    const text = readFileSync(join(ROOT, 'make', 'test.mk'), 'utf8');

    expect(text).toContain('TEST_ENV');
    expect(text).toContain('APP_ENV_LOGGER_LEVEL');
    expect(text).toContain('IGNIS_ROOT');
    expect(text).not.toContain('--env-file');
  });
});
