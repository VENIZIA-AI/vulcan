#!/usr/bin/env bun
/**
 * The release table, as a debug view: `vulcan x atlas releases` prints what atlas computes from
 * git (Project Contract v1, D1). No project commits `releases.json` any more - atlas computes the
 * table when it reads a source, so it is never one release behind.
 */
import { formatWithBun } from '@/common/format';
import { readAtlasProject } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { computeReleases } from './compute';

export class AtlasReleases {
  /** The computed table, as JSON; the project `vulcan x` handed over unless a test passes its own. */
  static render(opts: { project?: IAtlasProject } = {}): string {
    return formatWithBun({
      text: `${JSON.stringify(computeReleases({ project: opts.project ?? readAtlasProject() }), null, 2)}\n`,
      file: 'releases.json',
    });
  }
}

export const runReleasesCommand = (opts: { command?: string }): number => {
  if (opts.command !== undefined) {
    console.error('usage: vulcan x atlas releases');

    return 2;
  }

  process.stdout.write(AtlasReleases.render());

  return 0;
};
