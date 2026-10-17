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
  arrayOf(opts).flatMap(item => {
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
  arrayOf(opts).flatMap(item => {
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
  arrayOf(opts).flatMap(item => {
    const entry = recordOf({ value: item });
    const { id, file, renderer } = entry;

    return typeof id === 'string' && typeof file === 'string' && typeof renderer === 'string'
      ? [{ id, file: resolve(opts.bundle, file), renderer }]
      : [];
  });

const coverageOf = (opts: { value: unknown }): { name: string; path: string }[] =>
  arrayOf(opts).flatMap(item => {
    const entry = recordOf({ value: item });

    return typeof entry.name === 'string' && typeof entry.path === 'string'
      ? [{ name: entry.name, path: entry.path }]
      : [];
  });

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
    throw new Error(
      'okf: no project config - run through `vulcan x okf` (or add .configs/vulcan.config.ts)',
    );
  }

  if (cached?.text === text && cached.root === root) {
    return cached.project;
  }

  const config = recordOf({ value: JSON.parse(text) });
  const knowledge = recordOf({ value: config.knowledge });
  const okf = recordOf({ value: config.okf });
  const sections = recordOf({ value: okf.sections });
  const viz = recordOf({ value: okf.viz });
  const bundle = resolve(
    root,
    stringOf({ value: knowledge.bundle, fallback: OkfProjectConstants.DEFAULT_BUNDLE }),
  );
  const outputs = stringsOf({ value: viz.outputs });
  const copy = isRecord({ value: viz.copy }) ? recordOf({ value: viz.copy }) : undefined;

  const project: IOkfProject = {
    root,
    bundle,
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
        output => resolve(root, output),
      ),
      brand: stringOf({ value: viz.brand, fallback: brandOf({ root }) }),
      ...(copy === undefined ? {} : { copy }),
    },
  };

  cached = { text, root, project };

  return project;
};
