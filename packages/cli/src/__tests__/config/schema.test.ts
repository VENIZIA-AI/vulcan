import { describe, expect, test } from 'bun:test';
import { ProjectPackages, VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';

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

  test('theme is the colour the project is known by: left unset, hex only, strict', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).theme).toBeUndefined();
    expect(
      VULCAN_CONFIG_SCHEMA.parse({
        theme: { accent: '#0277bd', accentDark: '#38bdf8', accentText: '#01579b' },
      }).theme,
    ).toEqual({ accent: '#0277bd', accentDark: '#38bdf8', accentText: '#01579b' });
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: { accent: 'blue' } }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: { accent: '#fff' } }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ theme: {} }).success).toBe(true);
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ theme: { accent: '#0277bd', brand: '#000000' } }).success,
    ).toBe(false);
  });

  test('okf defaults to nothing selected - no renderer runs unless listed', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({});

    expect(config.okf.renderers).toEqual([]);
    expect(config.okf.regions).toEqual([]);
    expect(config.okf.coverage).toEqual([]);
    expect(config.okf.brand).toBeUndefined();
  });

  test('okf.brand is optional; the removed okf.viz and okf.sections are refused with the key and what to do', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ okf: { brand: 'ACME' } }).success).toBe(true);

    const viz = VULCAN_CONFIG_SCHEMA.safeParse({ okf: { viz: { outputs: ['x.html'] } } });
    const sections = VULCAN_CONFIG_SCHEMA.safeParse({ okf: { sections: { order: [] } } });

    expect(viz.success).toBe(false);
    expect(viz.error?.issues[0]?.path).toEqual(['okf', 'viz']);
    expect(viz.error?.issues[0]?.message).toContain('delete this key');
    expect(viz.error?.issues[0]?.message).toContain('vulcan x okf viz');
    expect(viz.error?.issues[0]?.message).toContain('okf.brand');
    expect(sections.error?.issues[0]?.path).toEqual(['okf', 'sections']);
    expect(sections.error?.issues[0]?.message).toContain('delete this key');
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

  test('a template with a placeholder it does not know is refused, and <package> is told to be <dir>', () => {
    expect(() =>
      VULCAN_CONFIG_SCHEMA.parse({ atlas: { tagPattern: '<package>-v<version>' } }),
    ).toThrow('<package> is not a placeholder of a release template');
    expect(() =>
      VULCAN_CONFIG_SCHEMA.parse({ atlas: { tagPattern: '<package>-v<version>' } }),
    ).toThrow('<dir> replaces <package>');
    expect(() =>
      VULCAN_CONFIG_SCHEMA.parse({
        atlas: { tagPattern: '<dir>-v<version>', legacyTagPatterns: ['<name>-<version>'] },
      }),
    ).toThrow('<name> is not a placeholder');
    expect(() =>
      VULCAN_CONFIG_SCHEMA.parse({ atlas: { tagPattern: '<dir >-<a>-v<version>' } }),
    ).toThrow('<dir >, <a> are not placeholders');

    for (const template of [
      '<dir>-v<version>',
      'v<version>',
      '[#<issue>] release(<dir>): <version>',
      '<version>-<date>',
    ]) {
      expect(VULCAN_CONFIG_SCHEMA.parse({ atlas: { tagPattern: template } }).atlas.tagPattern).toBe(
        template,
      );
    }
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
      path: 'frontends/features/merchant',
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

  test('ProjectPackages.resolve carries presetKind only when it is set', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      packages: [
        { dir: 'money', name: '@nx/money', path: 'libs/money', kind: 'lib', presetKind: 'shared' },
        { dir: 'feature', name: '@nx/feature', path: 'libs/feature', kind: 'lib' },
      ],
    });
    const packages = ProjectPackages.resolve({ config });

    expect(packages[0]).toMatchObject({ presetKind: 'shared' });
    expect(packages[1]).not.toHaveProperty('presetKind');
  });

  test('ProjectPackages.resolve carries the kind', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({
      packages: [
        {
          dir: 'merchant',
          name: '@nx-feature/merchant',
          path: 'frontends/features/merchant',
          kind: 'lib',
        },
      ],
    });

    expect(ProjectPackages.resolve({ config })[0]).toMatchObject({
      kind: 'lib',
      path: 'frontends/features/merchant',
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

describe('ProjectPackages.resolve', () => {
  test.each([
    ['packages', { b: '@x/b' }],
    ['releaseCommit', '[#<issue>] chore(<dir>): release v<version>'],
    ['typescriptFrom', '.'],
    ['legacyTagPrefixes', ['old-']],
  ])('atlas.%s is no key any more: the strict schema names it as unrecognized', (key, value) => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ atlas: { [key]: value } });
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);

    expect(result.success).toBe(false);
    expect(messages.join('; ')).toContain(`Unrecognized key: "${key}"`);
  });

  test('without packages the list is empty', () => {
    expect(ProjectPackages.resolve({ config: VULCAN_CONFIG_SCHEMA.parse({}) })).toEqual([]);
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
        { dir: 'backends-core', name: '@acme/backends-core', path: 'backends/core' },
        { dir: 'kits-core', name: '@acme/kits-core', path: 'frontends/kits/core' },
      ],
    });

    expect(ProjectPackages.resolve({ config }).map((entry) => entry.path)).toEqual([
      'backends/core',
      'frontends/kits/core',
    ]);
  });

  test('a repeated dir is an error that says dir is a key, not the directory name', () => {
    expect(
      messageOf([
        { dir: 'core', name: '@acme/backends-core', path: 'backends/core' },
        { dir: 'core', name: '@acme/kits-core', path: 'frontends/kits/core' },
      ]),
    ).toContain("packages: dir 'core' is used twice - dir is a unique key, not the directory name");
  });

  test.each(['JSONStream', '@Acme/kernel', '@acme/Kernel', '@acme/ker nel', '@acme/', ''])(
    "the package name '%s' is refused with a message that says why",
    (name) => {
      expect(messageOf([{ dir: 'kernel', name }])).toContain(
        `package name '${name}' is not an npm package name: npm names are lower case`,
      );
    },
  );

  test.each(['kernel', '@acme/kernel', '@acme/my-kernel.v2', 'a_b~c'])(
    "the package name '%s' is accepted",
    (name) => {
      expect(VULCAN_CONFIG_SCHEMA.safeParse({ packages: [{ dir: 'kernel', name }] }).success).toBe(
        true,
      );
    },
  );

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
