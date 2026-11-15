import { relative } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { InstalledPackages } from '@/sources/installed';
import { InstalledVersions } from '@/tools/common/installed-versions';

/**
 * What `vulcan x atlas status` prints: the sources the project reads, and for each `@venizia/*` package the app declares
 * the copy atlas reads its symbols from (the first one `InstalledPackages.copiesOf` finds, nearest the root; `symbol`
 * takes the first copy that has a version) and every other copy on disk, so a stale install is seen at a glance. It reads
 * the disk only; the pin of a source's docs is in the answer of the `version` tool.
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
