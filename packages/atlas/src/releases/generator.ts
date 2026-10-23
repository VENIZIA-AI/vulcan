#!/usr/bin/env bun
/**
 * The release table, as a debug view: `vulcan x atlas releases` prints what atlas computes from
 * git (Project Contract v1, D1). No project commits `releases.json` any more - atlas computes the
 * table when it reads a source, so it is never one release behind.
 */
import { resolveAll, splitFrontmatter } from '@/changelogs/resolve';
import { formatWithBun } from '@/common/format';
import { readAtlasProject } from '@/common/project-config';
import type { IAtlasPackage, IAtlasProject } from '@/common/project-config';
import { computeReleases, kindOfChangelog, titleOfChangelog } from './compute';

export class AtlasReleases {
  /** The computed table, as JSON; the project `vulcan x` handed over unless a test passes its own. */
  static render(opts: { project?: IAtlasProject } = {}): string {
    return formatWithBun({
      text: `${JSON.stringify(computeReleases({ project: opts.project ?? readAtlasProject() }), null, 2)}\n`,
      file: 'releases.json',
    });
  }

  /**
   * The packages one changelog entry declares (Project Contract v1, C3): its `packages:` list of npm
   * names, as directories. Prose is never read - `changelogs migrate` writes the list once.
   */
  static packagesOf(opts: { text: string; packages: IAtlasPackage[] }): string[] {
    const { data } = splitFrontmatter(opts.text);
    const listed: unknown[] = Array.isArray(data.packages) ? data.packages : [];

    return resolveAll({
      values: listed.filter((item): item is string => typeof item === 'string'),
      packages: opts.packages,
    });
  }

  static kindOf(opts: { text: string }): string | null {
    return kindOfChangelog(opts);
  }

  static titleOf(opts: { text: string; file: string }): string {
    return titleOfChangelog(opts);
  }
}

export const runReleasesCommand = (opts: { command?: string }): number => {
  if (opts.command === 'gen' || opts.command === 'check') {
    console.error(
      `vulcan x atlas releases ${opts.command}: gone in 0.2.0-0 - atlas computes releases from tags when it reads a source; delete .agents/knowledge/reference/releases.json, and \`vulcan x atlas releases\` prints the table`,
    );

    return 2;
  }

  process.stdout.write(AtlasReleases.render());

  return 0;
};
