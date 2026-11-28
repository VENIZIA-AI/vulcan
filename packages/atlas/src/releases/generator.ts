#!/usr/bin/env bun
/**
 * The release table, as a debug view: `vulcan atlas releases` prints what atlas computes from
 * git (Project Contract v1, D1). No project commits `releases.json` any more - atlas computes the
 * table when it reads a source, so it is never one release behind.
 */
import { BunFormatter } from '@/common/format';
import { ProjectConfig } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { ReleaseCompute } from './compute';

export class AtlasReleases {
  /** The computed table, as JSON; the project `vulcan atlas` or `vulcan okf` handed over unless a test passes its own. */
  static render(opts: { project?: IAtlasProject } = {}): string {
    return BunFormatter.format({
      text: `${JSON.stringify(ReleaseCompute.compute({ project: opts.project ?? ProjectConfig.readAtlasProject() }), null, 2)}\n`,
      file: 'releases.json',
    });
  }
}
