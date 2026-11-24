import { relative } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { SourceStatus } from '@/server/status';
import { SourceCache } from '@/sources/cache';
import { InstalledPackages } from '@/sources/installed';
import { InstalledVersions } from '@/tools/common/installed-versions';

/**
 * What `vulcan x atlas status` prints: the sources the project reads, and for each `@venizia/*` package the app
 * declares the copy atlas reads its symbols from (the first one `InstalledPackages.copiesOf` finds, nearest the root;
 * `symbol` reads it when it has a version, else the newest release on npm) and every other copy on disk, so a stale
 * install is seen at a glance. It reads the disk only; the pin of a source's docs is in the answer of the `version`
 * tool.
 */
/** A source still building after this long has most likely hung: `status` says so, and `vulcan doctor` warns. */
const STUCK_MS = 10 * 60 * 1000;

export class AtlasStatus {
  /** The sources as the last server run recorded them, one line each: state, how long ago, how long a build takes, the error. */
  static recordedLines(opts: { root: string; cacheDir?: string; now?: number }): string[] {
    const recorded = SourceStatus.read({
      file: SourceStatus.fileOf({
        cacheBase: SourceCache.cacheBaseOf({ cwd: opts.root, cacheDir: opts.cacheDir }),
      }),
    });
    const now = opts.now ?? Date.now();

    return Object.entries(recorded)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => {
        const ago = Math.max(0, Math.round((now - entry.since) / 1000));
        const usual =
          entry.durationMs === undefined
            ? ''
            : `; a build usually takes about ${Math.round(entry.durationMs / 1000)} s`;
        const stuck =
          entry.state === 'building' && now - entry.since > STUCK_MS
            ? ' - over 10 minutes: the build most likely hung or the server ended'
            : '';

        return `- ${name}: ${entry.state} for ${ago} s${usual}${entry.error === undefined ? '' : `; last error: ${entry.error}`}${stuck}`;
      });
  }

  /** Whether the record holds a source that failed, or one that has been building for over ten minutes. */
  static hasProblem(opts: { root: string; cacheDir?: string; now?: number }): boolean {
    return AtlasStatus.recordedLines(opts).some(
      (line) => line.includes(': failed ') || line.includes('over 10 minutes'),
    );
  }

  static report(opts: { root: string; cacheDir?: string }): string {
    const { root } = opts;
    const lines = [`atlas status for ${root}`, ''];
    const sources = ProjectConfig.hasAtlasProject({ root })
      ? ProjectConfig.readAtlasProject({ root }).sources
      : [];

    lines.push('Sources:');
    lines.push(
      ...(sources.length === 0
        ? ['- none declared']
        : sources.map((source) => `- ${source.name}: ${source.repo}@${source.ref}`)),
    );
    const recorded = AtlasStatus.recordedLines(opts);

    lines.push(
      '',
      'What the last server run recorded for each source (`building`, `ready` or `failed`):',
      ...(recorded.length === 0 ? ['- nothing yet: no atlas server has started here'] : recorded),
    );
    lines.push(
      '',
      'The @venizia/* packages this project declares, and the copy atlas reads of each (the first found, nearest the root):',
    );

    const roots = InstalledPackages.installRootsOf({ cwd: root });
    const installed = InstalledVersions.read({ cwd: root });

    for (const name of Object.keys(installed).sort()) {
      const [first, ...others] = InstalledPackages.copiesOf({ roots, name }).map((copy) => ({
        path: relative(root, copy.directory) || copy.directory,
        version: copy.version ?? '(no version)',
      }));

      if (first === undefined) {
        lines.push(`- ${name}: not installed`);
        continue;
      }

      lines.push(`- ${name} ${first.version} at ${first.path}`);

      for (const other of others) {
        lines.push(`  also installed: ${other.path} ${other.version}`);
      }

      if (others.some((other) => other.version !== first.version)) {
        lines.push('  the versions differ: atlas reads the first copy; make the install agree');
      }
    }

    lines.push(
      '',
      'The docs pin of each source (pinned to the installed version, or following its ref) is in the answer of the `version` tool.',
    );

    return `${lines.join('\n')}\n`;
  }
}
