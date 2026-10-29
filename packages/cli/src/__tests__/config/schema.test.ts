import { describe, expect, test } from 'bun:test';
import { resolvePackages, VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';

describe('VULCAN_CONFIG_SCHEMA', () => {
  test('packages carry dir, name, aliases and retired, defaulted', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({ packages: [{ dir: 'kernel', name: '@a/kernel' }] });

    expect(config.packages).toEqual([
      { dir: 'kernel', name: '@a/kernel', aliases: [], retired: false },
    ]);
  });

  test('agents is left unset unless the project suggests a list, and names only table agents', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).agents).toBeUndefined();
    expect(VULCAN_CONFIG_SCHEMA.parse({ agents: ['claude', 'omp'] }).agents).toEqual([
      'claude',
      'omp',
    ]);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ agents: ['vim'] }).success).toBe(false);
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
    expect(config.atlas.sources).toEqual([]);
  });

  test('legacy tag templates are optional, and each needs <version> like the current one', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).atlas.legacyTagPatterns).toBeUndefined();
    expect(
      VULCAN_CONFIG_SCHEMA.parse({
        atlas: { tagPattern: 'vulcan-v<version>', legacyTagPatterns: ['v<version>'] },
      }).atlas.legacyTagPatterns,
    ).toEqual(['v<version>']);
    expect(() => VULCAN_CONFIG_SCHEMA.parse({ atlas: { legacyTagPatterns: ['release'] } })).toThrow(
      'a template with <version>',
    );
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

describe('a source pin', () => {
  test("`pin` is 'installed' or 'ref', and absent unless given", () => {
    const parsed = (pin?: string) =>
      VULCAN_CONFIG_SCHEMA.safeParse({
        atlas: { sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ...(pin ? { pin } : {}) }] },
      });

    expect(parsed('ref').success).toBe(true);
    expect(parsed('installed').success).toBe(true);
    expect(parsed('latest').success).toBe(false);
    expect(parsed().data?.atlas.sources[0]).not.toHaveProperty('pin');
  });
});

describe('package kind', () => {
  test('a package may say it is a lib or an app; nothing else', () => {
    const base = {
      dir: 'merchant',
      name: '@nx-feature/merchant',
      path: 'auroras/features/merchant',
    };

    expect(
      VULCAN_CONFIG_SCHEMA.parse({ packages: [{ ...base, kind: 'lib' }] }).packages[0]?.kind,
    ).toBe('lib');
    expect(VULCAN_CONFIG_SCHEMA.parse({ packages: [base] }).packages[0]?.kind).toBeUndefined();
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ packages: [{ ...base, kind: 'tool' }] }).success).toBe(
      false,
    );
  });

  test('a package may say which preset kind made it: lib or shared; nothing else', () => {
    const base = {
      dir: 'money',
      name: '@nx/money',
      path: 'libs/money',
      kind: 'lib',
    } as const;

    expect(
      VULCAN_CONFIG_SCHEMA.parse({ packages: [{ ...base, presetKind: 'lib' }] }).packages[0]
        ?.presetKind,
    ).toBe('lib');
    expect(
      VULCAN_CONFIG_SCHEMA.parse({ packages: [{ ...base, presetKind: 'shared' }] }).packages[0]
        ?.presetKind,
    ).toBe('shared');
    expect(
      VULCAN_CONFIG_SCHEMA.parse({ packages: [base] }).packages[0]?.presetKind,
    ).toBeUndefined();
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ packages: [{ ...base, presetKind: 'app' }] }).success,
    ).toBe(false);
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ packages: [{ ...base, presetKind: '' }] }).success,
    ).toBe(false);
  });

  test('an entry without presetKind parses to exactly what it did before', () => {
    const entry = { dir: 'money', name: '@nx/money', path: 'libs/money', kind: 'lib' } as const;

    expect(VULCAN_CONFIG_SCHEMA.parse({ packages: [entry] }).packages[0]).toEqual({
      ...entry,
      aliases: [],
      retired: false,
    });
  });

  test('resolvePackages carries presetKind only when it is set', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      packages: [
        { dir: 'money', name: '@nx/money', path: 'libs/money', kind: 'lib', presetKind: 'shared' },
        { dir: 'feature', name: '@nx/feature', path: 'libs/feature', kind: 'lib' },
      ],
    });
    const packages = resolvePackages({ config });

    expect(packages[0]).toMatchObject({ presetKind: 'shared' });
    expect(packages[1]).not.toHaveProperty('presetKind');
  });

  test('resolvePackages carries the kind', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      packages: [
        {
          dir: 'merchant',
          name: '@nx-feature/merchant',
          path: 'auroras/features/merchant',
          kind: 'lib',
        },
      ],
    });

    expect(resolvePackages({ config })[0]).toMatchObject({
      kind: 'lib',
      path: 'auroras/features/merchant',
    });
  });
});

describe('presets', () => {
  test('a recorded preset may say it also makes libraries', () => {
    const preset = {
      spec: 'ardor',
      side: 'frontend',
      summary: 'An admin.',
      lib: 'A feature library.',
    } as const;

    expect(VULCAN_CONFIG_SCHEMA.parse({ presets: [preset] }).presets).toEqual([preset]);
  });

  test('a recorded preset may say it also makes shared packages', () => {
    const preset = {
      spec: 'ardor',
      side: 'frontend',
      summary: 'An admin.',
      lib: 'A feature library.',
      shared: 'A side-neutral package.',
    } as const;
    const sharedOnly = {
      spec: 'ignis',
      side: 'backend',
      summary: 'An API.',
      shared: 'Types.',
    } as const;

    expect(VULCAN_CONFIG_SCHEMA.parse({ presets: [preset] }).presets).toEqual([preset]);
    expect(VULCAN_CONFIG_SCHEMA.parse({ presets: [sharedOnly] }).presets).toEqual([sharedOnly]);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ presets: [{ ...preset, shared: 1 }] }).success).toBe(
      false,
    );
  });

  test('a recorded preset is { spec, side, summary }, side being backend or frontend', () => {
    const preset = { spec: 'ignis', side: 'backend', summary: 'An API.' } as const;

    expect(VULCAN_CONFIG_SCHEMA.parse({ presets: [preset] }).presets).toEqual([preset]);
    expect(VULCAN_CONFIG_SCHEMA.parse({}).presets).toBeUndefined();
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ presets: [{ ...preset, side: 'shared' }] }).success,
    ).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ presets: [{ spec: 'ignis' }] }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ presets: [{ ...preset, extra: 1 }] }).success).toBe(
      false,
    );
  });
});

describe('layout', () => {
  test('takes the three folder names, each a valid name', () => {
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ layout: { backend: 'services', shared: 'libs' } }).success,
    ).toBe(true);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ layout: { backend: 'Services' } }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ layout: { api: 'x' } }).success).toBe(false);
  });
});

describe('resolvePackages', () => {
  test('atlas.packages was removed: the error names the top-level packages that replaces it', () => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ atlas: { packages: { b: '@x/b' } } });
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);

    expect(result.success).toBe(false);
    expect(messages.join('; ')).toContain('atlas.packages was removed');
    expect(messages.join('; ')).toContain('packages: [{ dir');
  });

  test.each([
    ['releaseCommit', '[#<issue>] chore(<dir>): release v<version>'],
    ['typescriptFrom', '.'],
    ['legacyTagPrefixes', ['old-']],
  ])('atlas.%s was removed: the error names the key and says no tool reads it', (key, value) => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ atlas: { [key]: value } });
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);

    expect(result.success).toBe(false);
    expect(messages.join('; ')).toContain(`atlas.${key} was removed`);
    expect(messages.join('; ')).toContain('no tool reads it');
  });

  test('without packages the list is empty', () => {
    expect(resolvePackages({ config: VULCAN_CONFIG_SCHEMA.parse({}) })).toEqual([]);
  });
});

test('a renderer given as a bare string is its id', () => {
  const config = VULCAN_CONFIG_SCHEMA.parse({ okf: { renderers: ['source-map'] } });

  expect(config.okf.renderers).toEqual([{ id: 'source-map', options: {} }]);
});

describe('packages are keyed uniquely', () => {
  const messageOf = (packages: object[]): string | undefined => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ packages });

    return result.success
      ? undefined
      : result.error.issues.map((issue) => issue.message).join('; ');
  };

  test('two packages whose directories share a name work when their keys and paths differ', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      packages: [
        { dir: 'umbras-core', name: '@bana/umbras-core', path: 'umbras/core' },
        { dir: 'kits-core', name: '@bana/kits-core', path: 'auroras/kits/core' },
      ],
    });

    expect(resolvePackages({ config }).map((entry) => entry.path)).toEqual([
      'umbras/core',
      'auroras/kits/core',
    ]);
  });

  test('a repeated dir is an error that says dir is a key, not the directory name', () => {
    expect(
      messageOf([
        { dir: 'core', name: '@bana/umbras-core', path: 'umbras/core' },
        { dir: 'core', name: '@bana/kits-core', path: 'auroras/kits/core' },
      ]),
    ).toContain("packages: dir 'core' is used twice - dir is a unique key, not the directory name");
  });

  test('a repeated npm name is an error', () => {
    expect(
      messageOf([
        { dir: 'a', name: '@x/same' },
        { dir: 'b', name: '@x/same' },
      ]),
    ).toContain("packages: name '@x/same' is used twice");
  });

  test('two live packages at one path are an error, a retired one may keep its old path', () => {
    expect(
      messageOf([
        { dir: 'a', name: '@x/a', path: 'src/lib' },
        { dir: 'b', name: '@x/b', path: 'src/lib' },
      ]),
    ).toContain("packages: path 'src/lib' is used twice");
    expect(
      messageOf([
        { dir: 'old', name: '@x/old', path: 'src/lib', retired: true },
        { dir: 'new', name: '@x/new', path: 'src/lib' },
      ]),
    ).toBeUndefined();
  });
});

describe('okf.coverage axes', () => {
  test('exclude and denylist are per axis, default empty', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      okf: {
        coverage: [
          { name: 'apps', path: 'apps/*', exclude: ['apps/mobile-*'], denylist: ['shared'] },
          { name: 'kits', path: 'kits/*' },
        ],
      },
    });

    expect(config.okf.coverage).toEqual([
      { name: 'apps', path: 'apps/*', exclude: ['apps/mobile-*'], denylist: ['shared'] },
      { name: 'kits', path: 'kits/*', exclude: [], denylist: [] },
    ]);
  });

  test('an unknown key on an axis is still an error', () => {
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ okf: { coverage: [{ name: 'a', path: 'a/*', skip: [] }] } })
        .success,
    ).toBe(false);
  });
});
