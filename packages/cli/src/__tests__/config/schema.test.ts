import { describe, expect, test } from 'bun:test';
import { resolvePackages, VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';

describe('VULCAN_CONFIG_SCHEMA', () => {
  test('packages carry dir, name, aliases and retired, defaulted', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({ packages: [{ dir: 'kernel', name: '@a/kernel' }] });

    expect(config.packages).toEqual([
      { dir: 'kernel', name: '@a/kernel', aliases: [], retired: false },
    ]);
  });

  test('okf defaults to nothing selected - no renderer runs unless listed', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({});

    expect(config.okf.renderers).toEqual([]);
    expect(config.okf.regions).toEqual([]);
    expect(config.okf.coverage).toEqual([]);
    expect(config.okf.viz.outputs).toEqual(['.agents/knowledge/viz.html']);
  });

  test('a renderer entry is strict: a misspelled key is an error', () => {
    expect(() =>
      VULCAN_CONFIG_SCHEMA.parse({ okf: { renderers: [{ id: 'x', modul: 'a.ts' }] } }),
    ).toThrow();
  });

  test("release templates need <version>, and default to IGNIS's forms", () => {
    expect(() => VULCAN_CONFIG_SCHEMA.parse({ atlas: { tagPattern: 'release' } })).toThrow(
      'a template with <version>',
    );
    expect(
      VULCAN_CONFIG_SCHEMA.parse({ atlas: { tagPattern: 'v<version>' } }).atlas.tagPattern,
    ).toBe('v<version>');

    const config = VULCAN_CONFIG_SCHEMA.parse({});

    expect(config.atlas.tagPattern).toBe('<dir>-v<version>');
    expect(config.atlas.releaseCommit).toBe('[#<issue>] chore(<dir>): release v<version>');
    expect(config.atlas.sources).toEqual([]);
  });

  test('a source defaults its ref to develop', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      atlas: { sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis' }] },
    });

    expect(config.atlas.sources).toEqual([
      { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
    ]);
  });
});

describe('resolvePackages', () => {
  test('the top-level list wins', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      packages: [{ dir: 'a', name: '@x/a' }],
      atlas: { packages: { b: '@x/b' } },
    });

    expect(resolvePackages({ config }).map(entry => entry.dir)).toEqual(['a']);
  });

  test('atlas.packages is the alias for one release, in key order', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({ atlas: { packages: { b: '@x/b', a: '@x/a' } } });

    expect(resolvePackages({ config })).toEqual([
      { dir: 'b', name: '@x/b', aliases: [], retired: false },
      { dir: 'a', name: '@x/a', aliases: [], retired: false },
    ]);
  });
});

test('a renderer given as a bare string is its id', () => {
  const config = VULCAN_CONFIG_SCHEMA.parse({ okf: { renderers: ['source-map'] } });

  expect(config.okf.renderers).toEqual([{ id: 'source-map', options: {} }]);
});
