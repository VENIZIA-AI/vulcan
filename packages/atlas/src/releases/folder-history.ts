import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { VersionFolders } from '@/changelogs/version-folder';
import type { IVersionFolder } from '@/changelogs/version-folder';
import { AtlasGit, AtlasTimeouts } from '@/common/constants';
import type { IAtlasProject } from '@/common/project-config';
import { FolderAtKinds } from './common';
import type { IFolderHistory, TFolderAt } from './common';

const PLACEHOLDER = /<(dir|version)>|<[a-z]+>/g;

/** What git says about a path of a tag: three trees, never a blob, so it answers offline. */
const PATH_STATES = { PRESENT: 'present', ABSENT: 'absent', UNKNOWN: 'unknown' } as const;

type TPathState = (typeof PATH_STATES)[keyof typeof PATH_STATES];

/**
 * The version folders of a project as they were at its release tags: what a prerelease of a package said about its
 * line, which the final folders at HEAD no longer say. Read on demand from git, per tag and line, and cached.
 * A missing blob (a partial clone, offline) is an answer - `unreadable` - and never a network fetch.
 */
export class FolderHistory implements IFolderHistory {
  private head?: IVersionFolder[];
  private readonly cache = new Map<string, TFolderAt>();

  constructor(private readonly opts: { project: IAtlasProject }) {}

  folders(): IVersionFolder[] {
    const { changelogs } = this.opts.project.knowledge;

    this.head ??=
      changelogs === undefined
        ? []
        : VersionFolders.read({ directory: changelogs, within: this.opts.project.root }).filter(
            (folder) => folder.hasLog,
          );

    return this.head;
  }

  at(opts: { package: string; version: string; line: string }): TFolderAt {
    const key = `${opts.package}@${opts.version}#${opts.line}`;
    const known = this.cache.get(key);

    if (known !== undefined) {
      return known;
    }

    const found = this.read(opts);

    this.cache.set(key, found);

    return found;
  }

  private read(opts: { package: string; version: string; line: string }): TFolderAt {
    const { project } = this.opts;
    const directory = project.knowledge.changelogs;
    const dir = project.packages.find((entry) => entry.name === opts.package)?.dir;
    const tag = dir === undefined ? undefined : this.tagOf({ dir, version: opts.version });

    if (directory === undefined || tag === undefined) {
      return {
        kind: FolderAtKinds.UNREADABLE,
        reason: `no tag of ${opts.package} ${opts.version} is in this checkout`,
      };
    }

    const folder = `${relative(project.root, directory)}/${opts.line}`;
    const log = this.pathState({ tag, path: `${folder}/log.md` });

    if (log === PATH_STATES.ABSENT) {
      return { kind: FolderAtKinds.ABSENT, tag };
    }

    const migration = this.pathState({ tag, path: `${folder}/migration.yaml` });
    const logText =
      log === PATH_STATES.PRESENT ? this.blob({ tag, path: `${folder}/log.md` }) : undefined;
    const migrationText =
      migration === PATH_STATES.PRESENT
        ? this.blob({ tag, path: `${folder}/migration.yaml` })
        : undefined;

    if (
      logText === undefined ||
      migration === PATH_STATES.UNKNOWN ||
      (migration === PATH_STATES.PRESENT && migrationText === undefined)
    ) {
      return {
        kind: FolderAtKinds.UNREADABLE,
        tag,
        reason: `git cannot read ${folder} at ${tag} here (a partial clone does not hold it, or the tag is not fetched)`,
      };
    }

    return {
      kind: FolderAtKinds.FOLDER,
      tag,
      folder: VersionFolders.parse({ name: opts.line, log: logText, migration: migrationText }),
    };
  }

  /** The tag of `dir` at `version`: the first template of the project that renders to a tag this repository has. */
  private tagOf(opts: { dir: string; version: string }): string | undefined {
    const { project } = this.opts;

    for (const template of [project.tagPattern, ...(project.legacyTagPatterns ?? [])]) {
      let usable = true;
      const tag = template.replace(PLACEHOLDER, (match, name: string | undefined) => {
        if (name === 'dir') {
          return opts.dir;
        }

        if (name === 'version') {
          return opts.version;
        }

        usable = false;

        return match;
      });

      if (
        usable &&
        this.git({
          args: [
            'rev-parse',
            '--verify',
            '--quiet',
            '--end-of-options',
            `refs/tags/${tag}^{commit}`,
          ],
        }) !== undefined
      ) {
        return tag;
      }
    }

    return undefined;
  }

  private pathState(opts: { tag: string; path: string }): TPathState {
    const listed = this.git({
      args: [
        'ls-tree',
        '--name-only',
        '--end-of-options',
        `refs/tags/${opts.tag}`,
        '--',
        opts.path,
      ],
    });

    if (listed === undefined) {
      return PATH_STATES.UNKNOWN;
    }

    return listed.trim() === '' ? PATH_STATES.ABSENT : PATH_STATES.PRESENT;
  }

  private blob(opts: { tag: string; path: string }): string | undefined {
    return this.git({ args: ['show', '--end-of-options', `refs/tags/${opts.tag}:${opts.path}`] });
  }

  /** A git answer from the project root; `undefined` when it fails. A blob the clone lacks fails fast: git never fetches it from the remote. */
  private git(opts: { args: string[] }): string | undefined {
    const result = spawnSync('git', opts.args, {
      cwd: this.opts.project.root,
      encoding: 'utf8',
      timeout: AtlasTimeouts.LOCAL_GIT_MS,
      killSignal: 'SIGKILL',
      env: { ...AtlasGit.buildEnvironment(), GIT_NO_LAZY_FETCH: '1' },
    });

    return result.status === 0 ? result.stdout : undefined;
  }
}
