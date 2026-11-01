#!/usr/bin/env bun
/**
 * The release table, as a debug view: `vulcan x atlas releases` prints what atlas computes from
 * git (Project Contract v1, D1). No project commits `releases.json` any more - atlas computes the
 * table when it reads a source, so it is never one release behind.
 */
import { BunFormatter } from '@/common/format';
import { ProjectConfig } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { ReleaseCompute } from './compute';

export class AtlasReleases {
  /** The computed table, as JSON; the project `vulcan x` handed over unless a test passes its own. */
  static render(opts: { project?: IAtlasProject } = {}): string {
    return BunFormatter.format({
      text: `${JSON.stringify(ReleaseCompute.compute({ project: opts.project ?? ProjectConfig.readAtlasProject() }), null, 2)}\n`,
      file: 'releases.json',
    });
  }
}

export const runReleasesCommand = (opts: { command?: string }): number => {
  // A flag is ignored, as it always was; a word is a subcommand that does not exist.
  if (opts.command !== undefined && !opts.command.startsWith('-')) {
    console.error(`usage: vulcan x atlas releases (no subcommand: '${opts.command}' is not one)`);

    return 2;
  }

  process.stdout.write(AtlasReleases.render());

  return 0;
};
