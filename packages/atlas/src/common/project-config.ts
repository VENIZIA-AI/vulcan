import { resolve } from 'node:path';
import { compileReleaseTemplate } from '@/releases/template';

/** What `vulcan x` hands every tool; the generators read nothing else for their project. */
const CONFIG_ENV = 'VULCAN_CONFIG';
const ROOT_ENV = 'VULCAN_PROJECT_ROOT';

const DEFAULT_RELEASE_COMMIT = '[#<issue>] chore(<dir>): release v<version>';
const DEFAULT_TAG_PATTERN = '<dir>-v<version>';
const DEFAULT_BUNDLE = '.agents/knowledge';

export interface IAtlasPackage {
  dir: string;
  name: string;
  aliases: string[];
  retired: boolean;
}

export interface IAtlasProject {
  root: string;
  /** Release order; retired ones included, so their old changelogs and tags stay readable. */
  packages: IAtlasPackage[];
  /** `atlas.releaseCommit` compiled: named groups `dir`, `version`, `issue`. */
  releaseCommit: RegExp;
  /** `atlas.tagPattern`, the template of a release tag. */
  tagPattern: string;
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
            aliases: aliases.filter((alias): alias is string => typeof alias === 'string'),
            retired: entry.retired === true,
          },
        ];
  });

/**
 * A project from a resolved config (the cli validated it and resolved `packages` already): the
 * schema's defaults for anything absent, every path absolute.
 */
export const toAtlasProject = (opts: { root: string; config: unknown }): IAtlasProject => {
  const config = recordOf({ value: opts.config });
  const atlas = recordOf({ value: config.atlas });
  const knowledge = recordOf({ value: config.knowledge });
  const wiki = stringOf({ value: knowledge.wiki });
  const changelogs = stringOf({ value: knowledge.changelogs });
  const typescriptFrom = stringOf({ value: atlas.typescriptFrom });

  return {
    root: opts.root,
    packages: packagesOf({ value: config.packages }),
    releaseCommit: compileReleaseTemplate({
      template: stringOf({ value: atlas.releaseCommit }) ?? DEFAULT_RELEASE_COMMIT,
    }),
    tagPattern: stringOf({ value: atlas.tagPattern }) ?? DEFAULT_TAG_PATTERN,
    typescriptFrom: resolve(opts.root, typescriptFrom ?? '.'),
    knowledge: {
      bundle: resolve(opts.root, stringOf({ value: knowledge.bundle }) ?? DEFAULT_BUNDLE),
      ...(wiki === undefined ? {} : { wiki: resolve(opts.root, wiki) }),
      ...(changelogs === undefined ? {} : { changelogs: resolve(opts.root, changelogs) }),
    },
  };
};

/** Whether `vulcan x` handed a project over; the MCP server runs without one. */
export const hasAtlasProject = (): boolean =>
  process.env[CONFIG_ENV] !== undefined && process.env[ROOT_ENV] !== undefined;

/** The generators' project, from what `vulcan x` hands them. */
export const readAtlasProject = (): IAtlasProject => {
  const text = process.env[CONFIG_ENV];
  const root = process.env[ROOT_ENV];

  if (text === undefined || root === undefined) {
    throw new Error(
      'atlas: no project config - run through `vulcan x atlas` (or add .configs/vulcan.config.ts)',
    );
  }

  return toAtlasProject({ root, config: JSON.parse(text) });
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
