import { spawnSync } from 'node:child_process';
import { basename, relative } from 'node:path';
import { VersionFolders } from '@/changelogs/version-folder';
import { PRERELEASE_PART } from '@/changelogs/version-folder';
import { AtlasGit, AtlasTimeouts } from '@/common/constants';
import type { IAtlasProject } from '@/common/project-config';
import { StderrLogger } from '@/common/logger';
import { ReleaseTemplate } from '@/releases/template';
import { GitRepository } from './git';

const FETCH_CHUNK = 100;
const BLOB_LINE = /^\d+ blob ([0-9a-f]{40,64})\t/;

/**
 * The version folders of a fetched source, as its release tags held them. A source is cloned without blobs and read with
 * git told never to fetch one (a `migrate` call must not wait on the network), so the blobs `migrate` reads at the tags
 * of a prerelease are fetched here, when a source is pulled and the network is allowed: the two files of every line that
 * has a folder, at HEAD and at every tag of that line. A failure is a log line: the plan then says it read an earlier tag.
 */
export class FolderBlobs {
  /** The version folders at `sha`, as paths from the repository root; trees come with a partial clone, so this reads no blob. */
  static directoriesAt(opts: { gitDir: string; sha: string; folder: string }): string[] {
    const listed = FolderBlobs.git({
      cwd: opts.gitDir,
      args: ['ls-tree', '-d', '--name-only', opts.sha, `${opts.folder}/`],
    });

    return (listed ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((path) => VersionFolders.isName({ name: basename(path) }));
  }

  /** Fetches the missing blobs of the folders of `project`. Never throws; the outcome says what happened. */
  static prefetch(opts: { project: IAtlasProject; gitDir: string; url: string; sha: string }): {
    wanted: number;
    fetched: number;
    error?: string;
  } {
    const { project } = opts;
    const directory = project.knowledge.changelogs;

    if (directory === undefined) {
      return { wanted: 0, fetched: 0 };
    }

    const folder = relative(project.root, directory);
    const lines = new Set(
      FolderBlobs.directoriesAt({ gitDir: opts.gitDir, sha: opts.sha, folder }).map((path) =>
        basename(path),
      ),
    );

    if (lines.size === 0) {
      return { wanted: 0, fetched: 0 };
    }

    const refs = [opts.sha, ...FolderBlobs.tagsOfLines({ project, gitDir: opts.gitDir, lines })];
    const oids = new Set<string>();

    for (const ref of refs) {
      for (const line of lines) {
        const listed = FolderBlobs.git({
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

        for (const entry of (listed ?? '').split('\n')) {
          const oid = BLOB_LINE.exec(entry)?.[1];

          if (oid !== undefined) {
            oids.add(oid);
          }
        }
      }
    }

    const missing = FolderBlobs.missingOf({ gitDir: opts.gitDir, oids: [...oids] });
    let fetched = 0;

    try {
      for (let index = 0; index < missing.length; index += FETCH_CHUNK) {
        const chunk = missing.slice(index, index + FETCH_CHUNK);

        GitRepository.run({
          cwd: opts.gitDir,
          args: ['fetch', '-q', '--no-tags', '--', opts.url, ...chunk],
        });
        fetched += chunk.length;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      StderrLogger.get('FolderBlobs').warn(
        `the changelog blobs of the release tags were not fetched, so migrate reads earlier tags | error: ${message}`,
      );

      return { wanted: missing.length, fetched, error: message };
    }

    return { wanted: missing.length, fetched };
  }

  /** The tags a release template reads whose version is in a line that has a folder. */
  private static tagsOfLines(opts: {
    project: IAtlasProject;
    gitDir: string;
    lines: Set<string>;
  }): string[] {
    const patterns = [opts.project.tagPattern, ...(opts.project.legacyTagPatterns ?? [])].map(
      (template) => ReleaseTemplate.compile({ template }),
    );
    const tags = FolderBlobs.git({
      cwd: opts.gitDir,
      args: ['for-each-ref', 'refs/tags', '--format=%(refname:strip=2)'],
    });

    return (tags ?? '')
      .split('\n')
      .filter((tag) => tag !== '')
      .filter((tag) => {
        const version = patterns.map((pattern) => pattern.exec(tag)?.groups?.version).find(Boolean);

        return version !== undefined && opts.lines.has(version.replace(PRERELEASE_PART, ''));
      })
      .map((tag) => `refs/tags/${tag}`);
  }

  /** Which of `oids` this repository does not hold: `cat-file` told not to fetch answers `missing`. */
  private static missingOf(opts: { gitDir: string; oids: string[] }): string[] {
    if (opts.oids.length === 0) {
      return [];
    }

    const result = spawnSync('git', ['cat-file', '--batch-check'], {
      cwd: opts.gitDir,
      input: `${opts.oids.join('\n')}\n`,
      encoding: 'utf8',
      timeout: AtlasTimeouts.LOCAL_GIT_MS,
      killSignal: 'SIGKILL',
      env: { ...AtlasGit.buildEnvironment(), GIT_NO_LAZY_FETCH: '1' },
    });

    return (result.stdout ?? '')
      .split('\n')
      .filter((line) => line.endsWith(' missing'))
      .map((line) => line.split(' ')[0]);
  }

  private static git(opts: { cwd: string; args: string[] }): string | undefined {
    const result = spawnSync('git', opts.args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: AtlasTimeouts.LOCAL_GIT_MS,
      killSignal: 'SIGKILL',
      env: AtlasGit.buildEnvironment(),
    });

    return result.status === 0 ? result.stdout : undefined;
  }
}
