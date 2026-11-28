import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { Resolve } from '@/changelogs/resolve';
import { VersionFolders } from '@/changelogs/version-folder';
import { FRONTMATTER_PATTERN } from '@/corpus/frontmatter';
import { AtlasGit, AtlasTimeouts } from '@/common/constants';
import type { IAtlasProject } from '@/common/project-config';
import { ReleaseCompute } from '@/releases/compute';
import { StderrLogger } from '@venizia/vulcan-okf';
import type { IChangelogProblem } from './check';

const DATED_NAME = /^\d{4}-\d{2}-\d{2}-.*\.md$/;

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
 * The checks of `vulcan check changelog --history --base <ref>` that need git: a released version folder
 * is frozen, a stable tag has its folder, and no dated file, dated after `knowledge.datedUntil`, is added or edited. Run by CI on a pull request
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
        args: ['rev-parse', '--verify', '--quiet', '--end-of-options', `${opts.base}^{commit}`],
      }) === undefined
    ) {
      return [
        { file: opts.base, message: 'the base is not a commit of this repository (fetch it)' },
      ];
    }

    // The branch's own changes are measured from where it left the base: what landed on the base since (a release
    // commit that writes `released:`) is not the branch's doing.
    const since = git({
      root: project.root,
      args: ['merge-base', '--end-of-options', opts.base, 'HEAD'],
    })?.trim();

    if (since === undefined || since === '') {
      return [
        {
          file: opts.base,
          message:
            'the base and HEAD share no commit (fetch more history, or the base is unrelated)',
        },
      ];
    }

    problems.push(...ChangelogHistory.frozenProblems({ project, base: opts.base, since, at }));

    // Dual mode: until a project adopts the folders (a version cutover) its dated files stay the changelog.
    if (migrationFrom !== undefined && VersionFolders.isName({ name: migrationFrom })) {
      problems.push(...ChangelogHistory.datedProblems({ project, base: opts.base, since, at }));
      problems.push(
        ...ChangelogHistory.stableProblems({ project, directory, from: migrationFrom }),
      );
    }

    return problems;
  }

  /** A folder whose `log.md` carries `released:` where the branch left the base may not change, nor be deleted. */
  private static frozenProblems(opts: {
    project: IAtlasProject;
    base: string;
    since: string;
    at: string;
  }): IChangelogProblem[] {
    const { root } = opts.project;
    const listed =
      git({ root, args: ['ls-tree', '-d', '--name-only', opts.since, `${opts.at}/`] }) ?? '';
    const names = listed
      .split('\n')
      .map((line) => line.trim().split('/').at(-1) ?? '')
      .filter((name) => VersionFolders.isName({ name }));

    return names.flatMap((name) => {
      const log = git({ root, args: ['show', `${opts.since}:./${opts.at}/${name}/log.md`] });

      if (log === undefined || !ChangelogHistory.isReleased({ log })) {
        return [];
      }

      const changed = ChangelogHistory.changedFiles({
        root,
        since: opts.since,
        folder: `${opts.at}/${name}`,
      });
      const untracked = git({
        root,
        args: ['ls-files', '--others', '--exclude-standard', '--', `${opts.at}/${name}`],
      })?.trim();

      return changed.length > 0 || untracked
        ? [
            {
              file: `${name}/log.md`,
              message: `${name} was released at ${opts.base} and is frozen: its folder may not change (fix it in the line in progress)`,
            },
          ]
        : [];
    });
  }

  /**
   * The files of a released folder that differ from `since`. A `log.md` whose only difference is its `summary:` or
   * `highlights:` is not one: they are what the version box shows, not what the release is.
   */
  private static changedFiles(opts: { root: string; since: string; folder: string }): string[] {
    const listed =
      git({
        root: opts.root,
        args: [
          'diff',
          '--name-status',
          '--relative',
          '--end-of-options',
          opts.since,
          '--',
          opts.folder,
        ],
      })
        ?.trim()
        .split('\n')
        .filter((line) => line !== '') ?? [];

    return listed.filter((line) => {
      const [status, path] = line.split('\t');

      if (status !== 'M' || path === undefined || !path.endsWith('/log.md')) {
        return true;
      }

      const before = git({ root: opts.root, args: ['show', `${opts.since}:./${path}`] });

      try {
        const after = readFileSync(join(opts.root, path), 'utf8');

        return (
          before === undefined ||
          ChangelogHistory.withoutDisplayKeys({ text: before }) !==
            ChangelogHistory.withoutDisplayKeys({ text: after })
        );
      } catch (error) {
        StderrLogger.get('ChangelogHistory.changedFiles').debug(
          'a file whose text cannot be compared counts as changed | error: %s',
          error,
        );

        return true;
      }
    });
  }

  /** `text` without the `summary:` and `highlights:` keys of its frontmatter, each with the lines that belong to it. */
  private static withoutDisplayKeys(opts: { text: string }): string {
    const matched = opts.text.match(FRONTMATTER_PATTERN);

    if (matched === null) {
      return opts.text;
    }

    let isSkipping = false;
    const kept = matched[1].split('\n').filter((line) => {
      if (/^(summary|highlights)\s*:/.test(line)) {
        isSkipping = true;

        return false;
      }

      // a continuation of the key: an indented line, or a list item at the left edge
      if (isSkipping && (/^\s/.test(line) || line.startsWith('- '))) {
        return false;
      }

      isSkipping = false;

      return true;
    });

    // by position: a replacement pattern in the frontmatter (`$&`, `$$`) is text, never a pattern
    const start = matched[0].indexOf('\n') + 1;

    return `${opts.text.slice(0, start)}${kept.join('\n')}${opts.text.slice(start + matched[1].length)}`;
  }

  /** Whether a `log.md` carries a `released:` date; one that cannot be read is not released (the default check reports it). */
  private static isReleased(opts: { log: string }): boolean {
    try {
      const released = Resolve.splitFrontmatter(opts.log).data.released;

      return typeof released === 'string' && released !== '';
    } catch (error) {
      StderrLogger.get('ChangelogHistory.isReleased').debug(
        'a log whose frontmatter does not parse is not released | error: %s',
        error,
      );

      return false;
    }
  }

  /**
   * A dated file added or edited since the base: the changelog is the version folders now. A file dated on or before
   * `knowledge.datedUntil` is the old changelog the folders were folded from, so it is not a new entry; the default
   * check refuses a later one.
   */
  private static datedProblems(opts: {
    project: IAtlasProject;
    base: string;
    since: string;
    at: string;
  }): IChangelogProblem[] {
    const { root } = opts.project;
    const changed =
      git({
        root,
        args: [
          'diff',
          '--name-status',
          '--relative',
          '--end-of-options',
          opts.since,
          '--',
          opts.at,
        ],
      }) ?? '';
    const untracked =
      git({ root, args: ['ls-files', '--others', '--exclude-standard', '--', opts.at] }) ?? '';
    // A, M, and the new path of a rename or copy (R100\told\tnew): the last column.
    const added = changed
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([status]) => /^[AMRC]/.test(status ?? ''))
      .map((columns) => columns.at(-1));
    const files = [...added, ...untracked.split('\n')]
      .filter((file): file is string => file !== undefined && file !== '')
      .filter((file) => dirname(file) === opts.at)
      .map((file) => basename(file))
      .filter((name) => DATED_NAME.test(name))
      .filter(
        (name) =>
          opts.project.knowledge.datedUntil === undefined ||
          name.slice(0, 10) > opts.project.knowledge.datedUntil,
      );

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
    const live = new Set(
      opts.project.packages.filter((entry) => !entry.retired).map((entry) => entry.dir),
    );
    const stables = new Set(
      Object.entries(table.releases)
        .filter(([dir]) => live.has(dir))
        .flatMap(([, records]) => records)
        .map((release) => release.version)
        .filter((version) => VersionFolders.isName({ name: version }))
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
