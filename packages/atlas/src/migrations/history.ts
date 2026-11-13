import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Resolve } from '@/changelogs/resolve';
import { VersionFolders } from '@/changelogs/version-folder';
import { AtlasGit, AtlasTimeouts } from '@/common/constants';
import type { IAtlasProject } from '@/common/project-config';
import { ReleaseCompute } from '@/releases/compute';
import type { IChangelogProblem } from './check';

const DATED_NAME = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
const VERSION_CUTOVER = /^\d+\.\d+\.\d+$/;

/** A git answer from the project root; `undefined` when the command fails (a ref that is not there, no repository). */
const git = (opts: { root: string; args: string[] }): string | undefined => {
  const result = spawnSync('git', opts.args, {
    cwd: opts.root,
    encoding: 'utf8',
    timeout: AtlasTimeouts.LOCAL_GIT_MS,
    killSignal: 'SIGKILL',
    env: AtlasGit.buildEnvironment(),
  });

  return result.status === 0 ? result.stdout : undefined;
};

/**
 * The checks of `vulcan changelog check --history --base <ref>` that need git: a released version folder
 * is frozen, a stable tag has its folder, and no dated file is added or edited. Run by CI on a pull request
 * and by the stable release gate; the default check never runs git.
 */
export class ChangelogHistory {
  static scan(opts: { project: IAtlasProject; base: string }): IChangelogProblem[] {
    const { project } = opts;
    const { changelogs: directory, migrationFrom } = project.knowledge;

    if (directory === undefined) {
      return [];
    }

    const at = relative(project.root, directory);
    const problems: IChangelogProblem[] = [];

    if (
      git({
        root: project.root,
        args: ['rev-parse', '--verify', '--quiet', `${opts.base}^{commit}`],
      }) === undefined
    ) {
      return [
        { file: opts.base, message: 'the base is not a commit of this repository (fetch it)' },
      ];
    }

    problems.push(...ChangelogHistory.frozenProblems({ project, base: opts.base, at }));
    problems.push(...ChangelogHistory.datedProblems({ project, base: opts.base, at }));

    if (migrationFrom !== undefined && VERSION_CUTOVER.test(migrationFrom)) {
      problems.push(
        ...ChangelogHistory.stableProblems({ project, directory, from: migrationFrom }),
      );
    }

    return problems;
  }

  /** A folder whose `log.md` carries `released:` at the base may not change, nor be deleted. */
  private static frozenProblems(opts: {
    project: IAtlasProject;
    base: string;
    at: string;
  }): IChangelogProblem[] {
    const { root } = opts.project;
    const listed =
      git({ root, args: ['ls-tree', '-d', '--name-only', opts.base, `${opts.at}/`] }) ?? '';
    const names = listed
      .split('\n')
      .map((line) => line.trim().split('/').at(-1) ?? '')
      .filter((name) => VersionFolders.isName({ name }));

    return names.flatMap((name) => {
      const log = git({ root, args: ['show', `${opts.base}:${opts.at}/${name}/log.md`] });

      if (log === undefined || Resolve.splitFrontmatter(log).data.released === undefined) {
        return [];
      }

      const changed = git({
        root,
        args: ['diff', '--name-status', opts.base, '--', `${opts.at}/${name}`],
      })?.trim();
      const untracked = git({
        root,
        args: ['ls-files', '--others', '--exclude-standard', '--', `${opts.at}/${name}`],
      })?.trim();

      return changed || untracked
        ? [
            {
              file: `${name}/log.md`,
              message: `${name} was released at ${opts.base} and is frozen: its folder may not change (fix it in the line in progress)`,
            },
          ]
        : [];
    });
  }

  /** A dated file added or edited since the base: the changelog is the version folders now. */
  private static datedProblems(opts: {
    project: IAtlasProject;
    base: string;
    at: string;
  }): IChangelogProblem[] {
    const { root } = opts.project;
    const changed = git({ root, args: ['diff', '--name-status', opts.base, '--', opts.at] }) ?? '';
    const untracked =
      git({ root, args: ['ls-files', '--others', '--exclude-standard', '--', opts.at] }) ?? '';
    const added = changed
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([status]) => status === 'A' || status === 'M')
      .map(([, file]) => file);
    const files = [...added, ...untracked.split('\n')]
      .filter((file) => file !== undefined && file !== '')
      .map((file) => file.split('/').at(-1) ?? '')
      .filter((name) => DATED_NAME.test(name));

    return [...new Set(files)].map((file) => ({
      file,
      message: `a dated entry added or edited since ${opts.base}: write the item in changelogs/<X.Y.Z>/log.md of its version`,
    }));
  }

  /** A stable release at or above the cutover has its version folder. */
  private static stableProblems(opts: {
    project: IAtlasProject;
    directory: string;
    from: string;
  }): IChangelogProblem[] {
    const table = ReleaseCompute.compute({ project: opts.project });
    const stables = new Set(
      Object.values(table.releases)
        .flat()
        .map((release) => release.version)
        .filter((version) => VERSION_CUTOVER.test(version))
        .filter((version) => Bun.semver.order(version, opts.from) >= 0),
    );

    return [...stables]
      .filter((version) => !existsSync(join(opts.directory, version, 'log.md')))
      .map((version) => ({
        file: `${version}/log.md`,
        message: `${version} is a stable release at or above the cutover ${opts.from} and has no version folder`,
      }));
  }
}
