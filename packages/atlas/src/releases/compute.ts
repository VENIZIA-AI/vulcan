import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { resolveAll, splitFrontmatter } from '@/changelogs/resolve';
import { AtlasTimeouts } from '@/common/constants';
import { directoryOf } from '@/common/package-map';
import { isWithinDirectory } from '@/common/paths';
import type { IAtlasProject } from '@/common/project-config';
import type { IChangelogRecord, IReleaseRecord, IReleaseTable } from './common';
import { compileReleaseTemplate } from './template';

const SHORT_SHA_LENGTH = 8;
const GIT_BUFFER = 256 * 1024 * 1024;

/** An uncommitted changelog sorts after every committed release - inside the newest window. */
const UNCOMMITTED_POSITION = Number.MAX_SAFE_INTEGER;

const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})-/;
const BADGE_TEXT_PATTERN = /<Badge[^>]*\stext="([^"]*)"/;
/** `'<npm name>@<version>'` - a scoped name has its own `@`, so the version is after the last one. */
const RELEASE_OVERRIDE_PATTERN = /^(.+)@([^@]+)$/;

const byText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

const git = (opts: { root: string; args: string[] }): string => {
  const result = spawnSync('git', opts.args, {
    cwd: opts.root,
    encoding: 'utf8',
    maxBuffer: GIT_BUFFER,
    timeout: AtlasTimeouts.LOCAL_GIT_MS,
    killSignal: 'SIGKILL',
  });

  if (result.status !== 0) {
    throw new Error(
      `[computeReleases] git ${opts.args[0]} exited ${result.status}\n${result.stderr ?? ''}`,
    );
  }

  return result.stdout ?? '';
};

/** Whether `root` is the top of a git repository - a directory nested in another repository is not. */
const isRepositoryRoot = (opts: { root: string }): boolean => {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: opts.root,
    encoding: 'utf8',
    timeout: AtlasTimeouts.LOCAL_GIT_MS,
    killSignal: 'SIGKILL',
  });

  return result.status === 0 && realpathSync(result.stdout.trim()) === realpathSync(opts.root);
};

/** A repository with no commit yet has no HEAD, so no history: nothing was released. */
const hasCommits = (opts: { root: string }): boolean =>
  spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
    cwd: opts.root,
    timeout: AtlasTimeouts.LOCAL_GIT_MS,
    killSignal: 'SIGKILL',
  }).status === 0;

/**
 * Every commit of HEAD's history mapped to a position on the first-parent line, oldest first. A
 * commit off that line (a release tagged on a branch merged later) takes the position of the
 * first-parent merge that brought it in - never the end of history.
 */
const positionsOf = (opts: { root: string }): Map<string, number> => {
  const line = git({ root: opts.root, args: ['rev-list', '--first-parent', '--reverse', 'HEAD'] })
    .split('\n')
    .filter(hash => hash.length > 0);
  const parents = new Map(
    git({ root: opts.root, args: ['log', '--format=%H %P', 'HEAD'] })
      .split('\n')
      .filter(entry => entry.length > 0)
      .map(entry => {
        const [hash, ...rest] = entry.split(' ');

        return [hash, rest] as const;
      }),
  );
  const positions = new Map(line.map((hash, index) => [hash, index]));

  line.forEach((merge, index) => {
    const pending = (parents.get(merge) ?? []).slice(1);

    while (pending.length > 0) {
      const commit = pending.pop();

      if (commit === undefined || positions.has(commit)) {
        continue;
      }

      positions.set(commit, index);
      pending.push(...(parents.get(commit) ?? []));
    }
  });

  return positions;
};

/**
 * An order is a count of release commits, never a commit position: a release counts the release
 * commits before it, a changelog the ones before the commit that added it - all of them while it is
 * uncommitted, and still all of them once committed after the newest release.
 */
const releaseCommitsBefore = (opts: { positions: number[]; position: number }): number =>
  opts.positions.filter(position => position < opts.position).length;

interface IPositionedRelease {
  dir: string;
  record: IReleaseRecord;
}

/** Every tag the pattern reads, for a declared package - ignored tags and unknown packages left out. */
const releasesOf = (opts: {
  project: IAtlasProject;
  positions: Map<string, number>;
}): IPositionedRelease[] => {
  const { project } = opts;
  const pattern = compileReleaseTemplate({ template: project.tagPattern });
  const ignored = project.ignoreTags.map(glob => new Bun.Glob(glob));
  const live = project.packages.filter(entry => !entry.retired).map(entry => entry.dir);
  const format =
    '%(refname:strip=2)%09%(objectname)%09%(*objectname)%09%(authordate:short)%09%(*authordate:short)';

  return git({ root: project.root, args: ['for-each-ref', 'refs/tags', `--format=${format}`] })
    .split('\n')
    .filter(entry => entry.length > 0)
    .flatMap(entry => {
      const [tag, object, peeled, date, peeledDate] = entry.split('\t');
      const commit = peeled.length > 0 ? peeled : object;
      const position = opts.positions.get(commit);
      const groups = pattern.exec(tag)?.groups;

      // A tag outside HEAD's history (an unmerged branch) released nothing on this ref.
      if (
        ignored.some(glob => glob.match(tag)) ||
        groups?.version === undefined ||
        position === undefined
      ) {
        return [];
      }

      // A tag's directory resolves like any value - a renamed package's old tags are its history.
      const owner =
        groups.dir === undefined
          ? undefined
          : directoryOf({ value: groups.dir, packages: project.packages });
      const dirs = groups.dir === undefined ? live : owner === undefined ? [] : [owner];
      const record: IReleaseRecord = {
        version: groups.version,
        date: peeledDate.length > 0 ? peeledDate : date,
        sha: commit.slice(0, SHORT_SHA_LENGTH),
        order: position,
      };

      return dirs.map(dir => ({ dir, record }));
    });
};

/** When each changelog file was first added on the first-parent line; a rename keeps the first add. */
const changelogPositionsOf = (opts: {
  root: string;
  directory: string;
  positions: Map<string, number>;
}): Map<string, number> => {
  const log = git({
    root: opts.root,
    args: [
      'log',
      '--first-parent',
      '--diff-filter=AR',
      '-M',
      '--name-status',
      '--format=commit %H',
      '--',
      relative(opts.root, opts.directory),
    ],
  });
  const added = new Map<string, number>();
  let current = UNCOMMITTED_POSITION;

  // `git log` is newest first; a rename must see the add before it, so walk it oldest first.
  const blocks = log
    .split(/^commit /m)
    .filter(block => block.trim().length > 0)
    .reverse();

  for (const block of blocks) {
    const [hash, ...lines] = block.trim().split('\n');

    current = opts.positions.get(hash.trim()) ?? UNCOMMITTED_POSITION;

    for (const line of lines) {
      const [status, from, to] = line.split('\t');

      if (status === 'A' && from !== undefined) {
        added.set(basename(from), added.get(basename(from)) ?? current);
      }

      if (status?.startsWith('R') && from !== undefined && to !== undefined) {
        added.set(basename(to), added.get(basename(from)) ?? current);
      }
    }
  }

  return added;
};

/** The frontmatter `title`, falling back to the file stem - never blank. */
export const titleOfChangelog = (opts: { text: string; file: string }): string => {
  const { data } = splitFrontmatter(opts.text);

  return typeof data.title === 'string' && data.title.length > 0
    ? data.title
    : opts.file.replace(/\.md$/, '');
};

/** The first `<Badge ... text="X" />` in the file, or `null` when it carries none. */
export const kindOfChangelog = (opts: { text: string }): string | null =>
  BADGE_TEXT_PATTERN.exec(opts.text)?.[1] ?? null;

/**
 * Project Contract v1, D1: the release table, computed from git when atlas reads a source - nothing
 * is committed, so it is never one release behind. Releases are the tags `tagPattern` reads; each
 * dated changelog entry falls after the releases before the commit that added it, or where its
 * `release: '<npm name>@<version>'` override places it. Without history (a checkout fetched without
 * git, a repository with no commit) there are no releases, and the dated entries carry no order.
 */
export const computeReleases = (opts: { project: IAtlasProject }): IReleaseTable => {
  const { project } = opts;
  const live = project.packages
    .filter(entry => !entry.retired)
    .map(entry => entry.dir)
    .sort(byText);
  const packageMap = project.packages.map(entry => ({
    dir: entry.dir,
    name: entry.name,
    aliases: entry.aliases,
  }));

  if (!existsSync(project.root)) {
    return { livePackages: live, releases: {}, changelogs: [], packageMap };
  }

  const hasHistory = isRepositoryRoot({ root: project.root }) && hasCommits({ root: project.root });
  const positions = hasHistory ? positionsOf({ root: project.root }) : new Map<string, number>();
  const positioned = hasHistory ? releasesOf({ project, positions }) : [];
  const releasePositions = [...new Set(positioned.map(entry => entry.record.order ?? 0))].sort(
    (left, right) => left - right,
  );
  const countOf = (position: number): number =>
    releaseCommitsBefore({ positions: releasePositions, position });

  const releases: Record<string, IReleaseRecord[]> = {};

  for (const dir of [...new Set(positioned.map(entry => entry.dir))].sort(byText)) {
    releases[dir] = positioned
      .filter(entry => entry.dir === dir)
      .map(entry => ({ ...entry.record, order: countOf(entry.record.order ?? 0) }))
      .sort((left, right) => (right.order ?? 0) - (left.order ?? 0));
  }

  const directory = project.knowledge.changelogs;
  const changelogs: IChangelogRecord[] = [];

  // A changelog directory, or entry, that is a symlink out of the repository is not its history.
  if (
    directory !== undefined &&
    existsSync(directory) &&
    isWithinDirectory({ path: directory, directory: project.root })
  ) {
    const added = hasHistory
      ? changelogPositionsOf({ root: project.root, directory, positions })
      : undefined;
    const files = readdirSync(directory)
      .filter(file => DATE_PREFIX_PATTERN.test(file))
      .filter(file => isWithinDirectory({ path: join(directory, file), directory: project.root }))
      .sort(byText)
      .reverse();

    for (const file of files) {
      const text = readFileSync(`${directory}/${file}`, 'utf8');
      const { data } = splitFrontmatter(text);
      const listed: unknown[] = Array.isArray(data.packages) ? data.packages : [];
      const override =
        typeof data.release === 'string' ? RELEASE_OVERRIDE_PATTERN.exec(data.release) : null;
      const overrideDir = project.packages.find(entry => entry.name === override?.[1])?.dir;
      const placed = releases[overrideDir ?? '']?.find(record => record.version === override?.[2]);

      changelogs.push({
        id: `changelog:${file.replace(/\.md$/, '')}`,
        file,
        date: DATE_PREFIX_PATTERN.exec(file)?.[1] ?? '',
        title: titleOfChangelog({ text, file }),
        packages: resolveAll({
          values: listed.filter((item): item is string => typeof item === 'string'),
          packages: project.packages,
        }),
        kind: kindOfChangelog({ text }),
        ...(added === undefined
          ? {}
          : { order: placed?.order ?? countOf(added.get(file) ?? UNCOMMITTED_POSITION) }),
      });
    }
  }

  return { livePackages: live, releases, changelogs, packageMap };
};
