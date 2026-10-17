import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileReleaseTemplate } from '@/releases/template';

/** The project manifest (Project Contract v1, C1) - what atlas reads, and nothing else. */
const MANIFEST_FILE = '.agents/vulcan.manifest.json';
const MANIFEST_ENV = 'VULCAN_MANIFEST';
const ROOT_ENV = 'VULCAN_PROJECT_ROOT';
/** The manifest versions this atlas reads (V2); outside it, it says which VULCAN to upgrade to. */
const MANIFEST_SCHEMA_VERSION = 1;

const DEFAULT_RELEASE_COMMIT = '[#<issue>] chore(<dir>): release v<version>';
const DEFAULT_TAG_PATTERN = '<dir>-v<version>';
const DEFAULT_BUNDLE = '.agents/knowledge';

export interface IAtlasPackage {
  dir: string;
  name: string;
  /** From the root; `packages/<dir>` unless the manifest says otherwise. */
  path: string;
  aliases: string[];
  retired: boolean;
}

export interface IAtlasProject {
  root: string;
  /** Release order; retired ones included, so their old changelogs and tags stay readable. */
  packages: IAtlasPackage[];
  /** `atlas.releaseCommit` compiled: named groups `dir`, `version`, `issue`. */
  releaseCommit: RegExp;
  /** `release.tagPattern`, the template of a release tag. */
  tagPattern: string;
  /** `release.ignoreTags`: globs of tags neither read nor checked. */
  ignoreTags: string[];
  /** Absolute: where the project's `typescript` resolves from. */
  typescriptFrom: string;
  /** Absolute paths. */
  knowledge: { bundle: string; wiki?: string; changelogs?: string };
}

type TRecord = Record<string, unknown>;

const recordOf = (opts: { value: unknown }): TRecord =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value)
    ? Object.fromEntries(Object.entries(opts.value))
    : {};

const stringOf = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' ? opts.value : undefined;

const packagesOf = (opts: { value: unknown }): IAtlasPackage[] =>
  (Array.isArray(opts.value) ? opts.value : []).flatMap(item => {
    const entry = recordOf({ value: item });
    const dir = stringOf({ value: entry.dir });
    const aliases: unknown[] = Array.isArray(entry.aliases) ? entry.aliases : [];

    return dir === undefined
      ? []
      : [
          {
            dir,
            name: stringOf({ value: entry.name }) ?? dir,
            path: stringOf({ value: entry.path }) ?? `packages/${dir}`,
            aliases: aliases.filter((alias): alias is string => typeof alias === 'string'),
            retired: entry.retired === true,
          },
        ];
  });

/**
 * A project from its manifest (`vulcan sync` rendered it from a validated config): defaults for
 * anything absent, every path absolute. A schemaVersion this atlas does not read fails loudly.
 */
export const toAtlasProject = (opts: { root: string; manifest: unknown }): IAtlasProject => {
  const manifest = recordOf({ value: opts.manifest });
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
    packages: packagesOf({ value: manifest.packages }),
    // Read from tags once releases are computed (Task 11); until then the default release commit.
    releaseCommit: compileReleaseTemplate({ template: DEFAULT_RELEASE_COMMIT }),
    tagPattern: stringOf({ value: release.tagPattern }) ?? DEFAULT_TAG_PATTERN,
    ignoreTags: (Array.isArray(release.ignoreTags) ? release.ignoreTags : []).filter(
      (glob): glob is string => typeof glob === 'string',
    ),
    typescriptFrom: opts.root,
    knowledge: {
      bundle: resolve(opts.root, stringOf({ value: knowledge.bundle }) ?? DEFAULT_BUNDLE),
      ...(wiki === undefined ? {} : { wiki: resolve(opts.root, wiki) }),
      ...(changelogs === undefined ? {} : { changelogs: resolve(opts.root, changelogs) }),
    },
  };
};

const projectRoot = (): string => process.env[ROOT_ENV] ?? process.cwd();

/** Whether there is a project: `vulcan x` handed its manifest over, or the root carries one. */
export const hasAtlasProject = (): boolean =>
  process.env[MANIFEST_ENV] !== undefined || existsSync(join(projectRoot(), MANIFEST_FILE));

/** The project's manifest: the one `vulcan x` rendered fresh, else the committed file. */
export const readAtlasProject = (): IAtlasProject => {
  const root = projectRoot();
  const file = join(root, MANIFEST_FILE);
  const text =
    process.env[MANIFEST_ENV] ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

  if (text === undefined) {
    throw new Error(`atlas: no project manifest (${MANIFEST_FILE}) - run \`vulcan sync\``);
  }

  return toAtlasProject({ root, manifest: JSON.parse(text) });
};

/** The packages surface and symbols walk: the live ones, in release order. */
export const livePackageDirs = (opts: { project: IAtlasProject }): string[] => {
  const live = opts.project.packages.filter(entry => !entry.retired).map(entry => entry.dir);

  if (live.length === 0) {
    throw new Error(
      'atlas: add packages to .configs/vulcan.config.ts - the package directories under packages/, in release order',
    );
  }

  return live;
};

/** Every package the project has released, retired ones included. */
export const knownPackageDirs = (opts: { project: IAtlasProject }): string[] =>
  opts.project.packages.map(entry => entry.dir);
