import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { InstalledPackages } from '@/sources/installed';
import { InstalledVersions } from '@/tools/common/installed-versions';

const versionAt = (opts: { directory: string }): string => {
  try {
    const manifest = JSON.parse(readFileSync(join(opts.directory, 'package.json'), 'utf8'));

    return typeof manifest.version === 'string' ? manifest.version : '(no version)';
  } catch {
    return '(unreadable)';
  }
};

/**
 * What `vulcan x atlas status` prints: the sources the project reads, and for each `@venizia/*` package the app declares the
 * copy atlas reads its symbols from (the first one found, nearest the root) and every other copy on disk, so a stale
 * install is seen at a glance. It reads the disk only; the pin of a source's docs is in the answer of the `version` tool.
 */
export class AtlasStatus {
  static report(opts: { root: string }): string {
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
    lines.push('', 'Packages atlas reads symbols from (the first copy found, nearest the root):');

    const roots = InstalledPackages.installRootsOf({ cwd: root });
    const installed = InstalledVersions.read({ cwd: root });

    for (const name of Object.keys(installed).sort()) {
      const [first, ...others] = InstalledPackages.installedDirectoriesOf({ roots, name }).map(
        (directory) => ({
          path: relative(root, directory) || directory,
          version: versionAt({ directory }),
        }),
      );

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
