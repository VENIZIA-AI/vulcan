import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** The project manifest (Project Contract v1, C1) - what atlas reads, and nothing else. */
export const MANIFEST_FILE = '.agents/vulcan.manifest.json';
const MANIFEST_ENV = 'VULCAN_MANIFEST';
const ROOT_ENV = 'VULCAN_PROJECT_ROOT';
/** The manifest versions this atlas reads (V2); outside it, it says which VULCAN to upgrade to. */
const MANIFEST_SCHEMA_VERSION = 1;

/** An npm package name, the legacy upper case included: every character is safe in a path and a URL. */
const NPM_NAME_PATTERN = /^(?:@[A-Za-z0-9~-][\w.~-]*\/)?[A-Za-z0-9~-][\w.~-]*$/;
const NPM_NAME_MAX_LENGTH = 214;

const DEFAULT_TAG_PATTERN = '<dir>-v<version>';
const DEFAULT_BUNDLE = '.agents/knowledge';

export interface IAtlasPackage {
  dir: string;
  name: string;
  /** From the root; `packages/<dir>` unless the manifest says otherwise. */
  path: string;
  aliases: string[];
  retired: boolean;
  /** `lib` for a shared package a preset's lib kind made; absent for an app or a plain package. */
  kind?: 'app' | 'lib';
}

/** A preset an app of the project came from, as `vulcan add --preset` takes it back. */
export interface IAtlasPreset {
  spec: string;
  side: 'backend' | 'frontend';
  summary: string;
  /** The summary of the preset's lib kind, when it makes libraries. */
  lib?: string;
}

export interface IAtlasProject {
  root: string;
  /** The source name every result carries (`<name>-atlas` names the server). */
  name: string;
  /** Release order; retired ones included, so their old changelogs and tags stay readable. */
  packages: IAtlasPackage[];
  /** The folders `vulcan add` puts apps and shared packages in; absent in an older manifest. */
  layout?: { backend?: string; frontend?: string; shared?: string };
  /** The presets this project's apps came from; absent when none was recorded. */
  presets?: IAtlasPreset[];
  /** `release.tagPattern`, the template of a release tag. */
  tagPattern: string;
  /** `release.ignoreTags`: globs of tags neither read nor checked. */
  ignoreTags: string[];
  /** Absolute: where the project's `typescript` resolves from. */
  typescriptFrom: string;
  /** Absolute paths. */
  knowledge: { bundle: string; wiki?: string; changelogs?: string };
  /** The sources this project reads knowledge from (git mode): `atlas.sources` of its config. */
  sources: { name: string; repo: string; ref: string; pin?: 'installed' | 'ref' }[];
}

type TRecord = Record<string, unknown>;

const recordOf = (opts: { value: unknown }): TRecord =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value)
    ? Object.fromEntries(Object.entries(opts.value))
    : {};

const stringOf = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' ? opts.value : undefined;

/** Whether `name` is an npm package name - what a symbols cache file and a registry URL are built from. */
export const isNpmPackageName = (opts: { name: string }): boolean =>
  opts.name.length <= NPM_NAME_MAX_LENGTH && NPM_NAME_PATTERN.test(opts.name);

/** A fetched manifest is data from elsewhere: a name that is not an npm name never reaches a path. */
const packagesOf = (opts: { value: unknown; label: string }): IAtlasPackage[] =>
  (Array.isArray(opts.value) ? opts.value : []).flatMap((item) => {
    const entry = recordOf({ value: item });
    const dir = stringOf({ value: entry.dir });
    const aliases: unknown[] = Array.isArray(entry.aliases) ? entry.aliases : [];

    if (dir === undefined) {
      return [];
    }

    const name = stringOf({ value: entry.name }) ?? dir;

    if (!isNpmPackageName({ name })) {
      throw new Error(`atlas: ${opts.label} - package name '${name}' is not an npm package name`);
    }

    return [
      {
        dir,
        name,
        path: stringOf({ value: entry.path }) ?? `packages/${dir}`,
        aliases: aliases.filter((alias): alias is string => typeof alias === 'string'),
        retired: entry.retired === true,
        ...(entry.kind === 'lib' || entry.kind === 'app' ? { kind: entry.kind } : {}),
      },
    ];
  });

const layoutOf = (opts: { value: unknown }): Pick<IAtlasProject, 'layout'> => {
  const record = recordOf({ value: opts.value });
  const layout = Object.fromEntries(
    ['backend', 'frontend', 'shared'].flatMap((key) => {
      const folder = stringOf({ value: record[key] });

      return folder === undefined ? [] : [[key, folder]];
    }),
  );

  return Object.keys(layout).length === 0 ? {} : { layout };
};

const presetsOf = (opts: { value: unknown }): Pick<IAtlasProject, 'presets'> => {
  const presets = (Array.isArray(opts.value) ? opts.value : []).flatMap((item): IAtlasPreset[] => {
    const entry = recordOf({ value: item });
    const spec = stringOf({ value: entry.spec });
    const summary = stringOf({ value: entry.summary });
    const lib = stringOf({ value: entry.lib });

    return spec === undefined ||
      summary === undefined ||
      (entry.side !== 'backend' && entry.side !== 'frontend')
      ? []
      : [{ spec, side: entry.side, summary, ...(lib === undefined ? {} : { lib }) }];
  });

  return presets.length === 0 ? {} : { presets };
};

/**
 * A project from its manifest (`vulcan sync` rendered it from a validated config): defaults for
 * anything absent, every path absolute. A schemaVersion this atlas does not read fails loudly.
 * `source` names a fetched source in an error; a project names itself.
 */
export const toAtlasProject = (opts: {
  root: string;
  manifest: unknown;
  source?: string;
}): IAtlasProject => {
  const manifest = recordOf({ value: opts.manifest });
  const projectName = stringOf({ value: manifest.name }) ?? basename(opts.root);
  const release = recordOf({ value: manifest.release });
  const knowledge = recordOf({ value: manifest.knowledge });
  const wiki = stringOf({ value: knowledge.wiki });
  const changelogs = stringOf({ value: knowledge.changelogs });

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `atlas: the manifest is schemaVersion ${String(manifest.schemaVersion)}; @venizia/vulcan-atlas reads ${MANIFEST_SCHEMA_VERSION} - upgrade @venizia/vulcan`,
    );
  }

  return {
    root: opts.root,
    name: projectName,
    packages: packagesOf({
      value: manifest.packages,
      label: opts.source ?? `project '${projectName}'`,
    }),
    ...layoutOf({ value: manifest.layout }),
    ...presetsOf({ value: manifest.presets }),
    tagPattern: stringOf({ value: release.tagPattern }) ?? DEFAULT_TAG_PATTERN,
    ignoreTags: (Array.isArray(release.ignoreTags) ? release.ignoreTags : []).filter(
      (glob): glob is string => typeof glob === 'string',
    ),
    typescriptFrom: opts.root,
    sources: (Array.isArray(manifest.sources) ? manifest.sources : []).flatMap((item) => {
      const source = recordOf({ value: item });
      const name = stringOf({ value: source.name });
      const repo = stringOf({ value: source.repo });
      const pin = source.pin === 'installed' || source.pin === 'ref' ? source.pin : undefined;

      return name === undefined || repo === undefined
        ? []
        : [
            {
              name,
              repo,
              ref: stringOf({ value: source.ref }) ?? 'develop',
              ...(pin === undefined ? {} : { pin }),
            },
          ];
    }),
    knowledge: {
      bundle: resolve(opts.root, stringOf({ value: knowledge.bundle }) ?? DEFAULT_BUNDLE),
      ...(wiki === undefined ? {} : { wiki: resolve(opts.root, wiki) }),
      ...(changelogs === undefined ? {} : { changelogs: resolve(opts.root, changelogs) }),
    },
  };
};

/** `root` when given (`--root`), else the one `vulcan x` named, else the working directory. */
const projectRoot = (opts: { root?: string }): string =>
  resolve(opts.root ?? process.env[ROOT_ENV] ?? process.cwd());

/** The manifest `vulcan x` handed over - only for the root it named. */
const handedManifest = (opts: { root: string }): string | undefined =>
  resolve(process.env[ROOT_ENV] ?? process.cwd()) === opts.root
    ? process.env[MANIFEST_ENV]
    : undefined;

/** Whether `root` is a project: `vulcan x` handed its manifest over, or it carries one. */
export const hasAtlasProject = (opts: { root?: string } = {}): boolean => {
  const root = projectRoot(opts);

  return handedManifest({ root }) !== undefined || existsSync(join(root, MANIFEST_FILE));
};

/** The project's manifest: the one `vulcan x` rendered fresh, else the committed file. */
export const readAtlasProject = (opts: { root?: string } = {}): IAtlasProject => {
  const root = projectRoot(opts);
  const file = join(root, MANIFEST_FILE);
  const text =
    handedManifest({ root }) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

  if (text === undefined) {
    throw new Error(`atlas: no project manifest (${MANIFEST_FILE}) - run \`vulcan sync\``);
  }

  return toAtlasProject({ root, manifest: JSON.parse(text) });
};

/** The packages surface and symbols walk: the live ones, in release order. */
export const livePackageDirs = (opts: { project: IAtlasProject }): string[] => {
  const live = opts.project.packages.filter((entry) => !entry.retired).map((entry) => entry.dir);

  if (live.length === 0) {
    throw new Error(
      'atlas: add packages to .configs/vulcan.config.* - the package directories under packages/, in release order',
    );
  }

  return live;
};

/** Where a package lives, from the root: the manifest's `path` (an application keeps them outside packages/). */
export const packagePathOf = (opts: { project?: IAtlasProject; dir: string }): string =>
  opts.project?.packages.find((entry) => entry.dir === opts.dir)?.path ?? `packages/${opts.dir}`;

/** Every package the project has released, retired ones included. */
export const knownPackageDirs = (opts: { project: IAtlasProject }): string[] =>
  opts.project.packages.map((entry) => entry.dir);
