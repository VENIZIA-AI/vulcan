import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OkfProjectConstants } from './common/index.ts';
import type {
  IOkfPackage,
  IOkfProject,
  IOkfRegionEntry,
  IOkfRendererEntry,
} from './common/index.ts';

type TRecord = Record<string, unknown>;

const isRecord = (opts: { value: unknown }): opts is { value: TRecord } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const recordOf = (opts: { value: unknown }): TRecord => (isRecord(opts) ? opts.value : {});

const stringOf = (opts: { value: unknown; fallback: string }): string =>
  typeof opts.value === 'string' ? opts.value : opts.fallback;

const arrayOf = (opts: { value: unknown }): unknown[] =>
  Array.isArray(opts.value) ? opts.value : [];

const stringsOf = (opts: { value: unknown }): string[] =>
  arrayOf(opts).filter((item): item is string => typeof item === 'string');

/** `@acme/shop-workspace` -> `SHOP`; the directory name when the project has no package.json name. */
const brandOf = (opts: { root: string }): string => {
  const manifest = join(opts.root, 'package.json');
  const parsed = { value: existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {} };
  const name = stringOf({
    value: recordOf(parsed).name,
    fallback: opts.root.split('/').pop() ?? '',
  });

  return name
    .replace(/^@[^/]+\//, '')
    .replace(/-workspace$/, '')
    .toUpperCase();
};

const packagesOf = (opts: { value: unknown; root: string }): IOkfPackage[] =>
  arrayOf(opts).flatMap((item) => {
    const entry = recordOf({ value: item });
    const dir = entry.dir;

    return typeof dir === 'string'
      ? [
          {
            dir,
            name: stringOf({ value: entry.name, fallback: dir }),
            path: resolve(opts.root, stringOf({ value: entry.path, fallback: `packages/${dir}` })),
            retired: entry.retired === true,
          },
        ]
      : [];
  });

const renderersOf = (opts: { value: unknown }): IOkfRendererEntry[] =>
  arrayOf(opts).flatMap((item) => {
    if (typeof item === 'string') {
      return [{ id: item, options: {} }];
    }

    const entry = recordOf({ value: item });
    const id = entry.id;

    if (typeof id !== 'string') {
      return [];
    }

    const module = typeof entry.module === 'string' ? entry.module : undefined;

    return [
      {
        id,
        ...(module === undefined ? {} : { module }),
        options: recordOf({ value: entry.options }),
      },
    ];
  });

const regionsOf = (opts: { value: unknown; bundle: string }): IOkfRegionEntry[] =>
  arrayOf(opts).flatMap((item) => {
    const entry = recordOf({ value: item });
    const { id, file, renderer } = entry;

    return typeof id === 'string' && typeof file === 'string' && typeof renderer === 'string'
      ? [{ id, file: resolve(opts.bundle, file), renderer }]
      : [];
  });

const coverageOf = (opts: {
  value: unknown;
}): { name: string; path: string; exclude: string[]; denylist: string[] }[] =>
  arrayOf(opts).flatMap((item) => {
    const entry = recordOf({ value: item });

    return typeof entry.name === 'string' && typeof entry.path === 'string'
      ? [
          {
            name: entry.name,
            path: entry.path,
            exclude: stringsOf({ value: entry.exclude }),
            denylist: stringsOf({ value: entry.denylist }),
          },
        ]
      : [];
  });

const GLOB_CHARACTERS = /[*?[\]{}]/;

/** `okf.contents.files`: literal paths and globs from the root, as absolute paths, each file once, in the order given. */
const contentsFilesOf = (opts: { patterns: string[]; root: string }): string[] => [
  ...new Set(
    opts.patterns.flatMap((pattern) =>
      GLOB_CHARACTERS.test(pattern)
        ? [...new Bun.Glob(pattern).scanSync({ cwd: opts.root, onlyFiles: true })]
            .sort()
            .map((file) => resolve(opts.root, file))
        : [resolve(opts.root, pattern)],
    ),
  ),
];

/** The handoff, parsed: only `vulcan x` writes it, so anything else is okf run by hand. */
const parsedOf = (opts: { text: string }): unknown => {
  try {
    return JSON.parse(opts.text);
  } catch (error) {
    throw new Error('okf: VULCAN_CONFIG is not valid JSON - run okf through `vulcan x`', {
      cause: error,
    });
  }
};

/** The last handoff read and what it gave: okf reads its project once per process. */
let cached: { text: string; root: string; project: IOkfProject } | undefined;

/**
 * okf's view of the project, from what `vulcan x` hands it. The cli validated the config already;
 * this only reads it, with the schema's defaults for anything absent, and resolves every path.
 */
export const readOkfProject = (): IOkfProject => {
  const text = process.env[OkfProjectConstants.CONFIG_ENV];
  const root = process.env[OkfProjectConstants.ROOT_ENV];

  if (text === undefined || root === undefined) {
    throw new Error('okf: no project config - run through `vulcan x okf`');
  }

  if (cached?.text === text && cached.root === root) {
    return cached.project;
  }

  const config = recordOf({ value: parsedOf({ text }) });
  const knowledge = recordOf({ value: config.knowledge });
  const okf = recordOf({ value: config.okf });
  const sections = recordOf({ value: okf.sections });
  const viz = recordOf({ value: okf.viz });
  const bundle = resolve(
    root,
    stringOf({ value: knowledge.bundle, fallback: OkfProjectConstants.DEFAULT_BUNDLE }),
  );
  const outputs = stringsOf({ value: viz.outputs });
  const changelogs = knowledge.changelogs;
  const atlas = recordOf({ value: config.atlas });
  const copy = isRecord({ value: viz.copy }) ? recordOf({ value: viz.copy }) : undefined;

  const project: IOkfProject = {
    root,
    bundle,
    ...(typeof changelogs === 'string' ? { changelogs: resolve(root, changelogs) } : {}),
    tagPattern: stringOf({
      value: atlas.tagPattern,
      fallback: OkfProjectConstants.DEFAULT_TAG_PATTERN,
    }),
    contentsFiles: contentsFilesOf({
      patterns: Array.isArray(recordOf({ value: okf.contents }).files)
        ? stringsOf({ value: recordOf({ value: okf.contents }).files })
        : OkfProjectConstants.DEFAULT_CONTENTS_FILES,
      root,
    }),
    packages: packagesOf({ value: config.packages, root }),
    renderers: renderersOf({ value: okf.renderers }),
    regions: regionsOf({ value: okf.regions, bundle }),
    sections: {
      order: stringsOf({ value: sections.order }),
      labels: Object.fromEntries(
        Object.entries(recordOf({ value: sections.labels })).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    },
    coverage: coverageOf({ value: okf.coverage }),
    denylist: new Set(stringsOf({ value: okf.denylist })),
    viz: {
      outputs: (outputs.length > 0 ? outputs : [OkfProjectConstants.DEFAULT_VIZ_OUTPUT]).map(
        (output) => resolve(root, output),
      ),
      brand: stringOf({ value: viz.brand, fallback: brandOf({ root }) }),
      ...(copy === undefined ? {} : { copy }),
    },
  };

  cached = { text, root, project };

  return project;
};
