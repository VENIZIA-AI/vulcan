import { basename, relative } from 'node:path';
import { PRERELEASE_PART, VersionFolders } from '@/changelogs/version-folder';
import { GitLocal } from '@/common/git-local';
import { StderrLogger } from '@/common/logger';
import type { IAtlasProject } from '@/common/project-config';
import { ReleaseTemplate } from '@/releases/template';
import { VulcanError } from '@venizia/vulcan-okf';
import { GitRepository } from './git';

const FETCH_CHUNK = 100;
const BLOB_LINE = /^\d+ blob ([0-9a-f]{40,64})\t/;

interface IPrefetchOutcome {
  wanted: number;
  fetched: number;
  /** Why the blobs were not all fetched; absent when they were. */
  error?: string;
}

/**
 * The version folders of a fetched source, as its release tags held them. A source is cloned without blobs and read with
 * git told never to fetch one (a `migrate` call must not wait on the network), so the blobs `migrate` reads at the tags
 * of a prerelease are fetched here, when a source is pulled and the network is allowed: the two files of every line that
 * has a folder, at HEAD and at every tag of that line. A failure is a log line and a result, never an exception: the plan
 * then says it read an earlier tag.
 */
export class FolderBlobs {
  /** The version folders at `sha`, as paths from the repository root; trees come with a partial clone, so this reads no blob. */
  static directoriesAt(opts: { gitDir: string; sha: string; folder: string }): string[] {
    const listed = GitLocal.read({
      cwd: opts.gitDir,
      args: ['ls-tree', '-d', '--name-only', '--end-of-options', opts.sha, '--', `${opts.folder}/`],
    }).stdout;

    return (listed ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((path) => VersionFolders.isName({ name: basename(path) }));
  }

  /** The same listing as `directoriesAt`, but a git failure is an error: a prefetch that cannot list what it fetches has done nothing. */
  private static directoriesOf(opts: { gitDir: string; sha: string; folder: string }): string[] {
    return FolderBlobs.must({
      cwd: opts.gitDir,
      args: ['ls-tree', '-d', '--name-only', '--end-of-options', opts.sha, '--', `${opts.folder}/`],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((path) => VersionFolders.isName({ name: basename(path) }));
  }

  /** The output of a local git read; a failure throws, naming git's own reason. */
  private static must(opts: { cwd: string; args: string[] }): string {
    const read = GitLocal.read(opts);

    if (read.stdout === undefined) {
      throw VulcanError.of({ message: read.error ?? `git ${opts.args[0]} failed` });
    }

    return read.stdout;
  }

  /** Fetches the missing blobs of the folders of `project`. Never throws; the outcome says what happened. */
  static prefetch(opts: {
    project: IAtlasProject;
    gitDir: string;
    url: string;
    sha: string;
  }): IPrefetchOutcome {
    // An older git cannot be told not to fetch inside the checks below, and a plan could not read the blobs anyway.
    if (!GitLocal.refusesLazyFetch()) {
      return FolderBlobs.failed({
        wanted: 0,
        fetched: 0,
        message: 'this git is older than 2.44, so the blobs are not prefetched',
      });
    }

    let wanted = 0;
    let fetched = 0;

    try {
      const missing = FolderBlobs.missingBlobs(opts);

      wanted = missing.length;

      for (let index = 0; index < missing.length; index += FETCH_CHUNK) {
        const chunk = missing.slice(index, index + FETCH_CHUNK);

        GitRepository.run({
          cwd: opts.gitDir,
          args: ['fetch', '-q', '--no-tags', '--', opts.url, ...chunk],
        });
        fetched += chunk.length;
      }
    } catch (error) {
      return FolderBlobs.failed({
        wanted,
        fetched,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return { wanted, fetched };
  }

  private static failed(opts: {
    wanted: number;
    fetched: number;
    message: string;
  }): IPrefetchOutcome {
    StderrLogger.get('FolderBlobs').warn(
      `the changelog blobs of the release tags were not fetched, so migrate reads earlier tags | error: ${opts.message}`,
    );

    return { wanted: opts.wanted, fetched: opts.fetched, error: opts.message };
  }

  /** The blobs of the two files of every line that has a folder, at HEAD and at the tags of that line, that this clone lacks. */
  private static missingBlobs(opts: {
    project: IAtlasProject;
    gitDir: string;
    sha: string;
  }): string[] {
    const { project } = opts;
    const directory = project.knowledge.changelogs;

    if (directory === undefined) {
      return [];
    }

    const folder = relative(project.root, directory);
    const lines = new Set(
      FolderBlobs.directoriesOf({ gitDir: opts.gitDir, sha: opts.sha, folder }).map((path) =>
        basename(path),
      ),
    );

    if (lines.size === 0) {
      return [];
    }

    // A tag is read for its own line only: a tag of 0.4.8-3 holds no reason to list the folder of 0.4.5.
    const reads = [
      ...[...lines].map((line) => ({ ref: opts.sha, line })),
      ...FolderBlobs.tagsOfLines({ project, gitDir: opts.gitDir, lines }),
    ];
    const oids = new Set<string>();

    for (const { ref, line } of reads) {
      const listed = FolderBlobs.must({
        cwd: opts.gitDir,
        args: [
          'ls-tree',
          '--end-of-options',
          ref,
          '--',
          `${folder}/${line}/log.md`,
          `${folder}/${line}/migration.yaml`,
        ],
      });

      for (const entry of listed.split('\n')) {
        const oid = BLOB_LINE.exec(entry)?.[1];

        if (oid !== undefined) {
          oids.add(oid);
        }
      }
    }

    return FolderBlobs.missingOf({ gitDir: opts.gitDir, oids: [...oids] });
  }

  /** The tags a release template reads whose version is in a line that has a folder, each with its line. */
  private static tagsOfLines(opts: {
    project: IAtlasProject;
    gitDir: string;
    lines: Set<string>;
  }): { ref: string; line: string }[] {
    const patterns = [opts.project.tagPattern, ...(opts.project.legacyTagPatterns ?? [])].map(
      (template) => ReleaseTemplate.compile({ template }),
    );
    const tags = FolderBlobs.must({
      cwd: opts.gitDir,
      args: ['for-each-ref', 'refs/tags', '--format=%(refname:strip=2)'],
    });

    return tags
      .split('\n')
      .filter((tag) => tag !== '')
      .flatMap((tag) => {
        const version = patterns.map((pattern) => pattern.exec(tag)?.groups?.version).find(Boolean);
        const line = version?.replace(PRERELEASE_PART, '');

        return line !== undefined && opts.lines.has(line)
          ? [{ ref: `refs/tags/${tag}`, line }]
          : [];
      });
  }

  /** Which of `oids` this repository does not hold: `cat-file` told not to fetch answers `missing`. A failed check is an error. */
  private static missingOf(opts: { gitDir: string; oids: string[] }): string[] {
    if (opts.oids.length === 0) {
      return [];
    }

    const checked = GitLocal.read({
      cwd: opts.gitDir,
      args: ['cat-file', '--batch-check'],
      input: `${opts.oids.join('\n')}\n`,
      noLazyFetch: true,
    });

    if (checked.stdout === undefined) {
      throw VulcanError.of({ message: checked.error ?? 'git cat-file failed' });
    }

    return checked.stdout
      .split('\n')
      .filter((line) => line.endsWith(' missing'))
      .map((line) => line.split(' ')[0]);
  }
}
