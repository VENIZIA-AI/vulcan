import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasBlock } from '../agents/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { ProjectManifest } from '../manifest/index.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

export class AtlasBlockPlan {
  /**
   * The block's text for this project, or undefined when AGENTS.md is absent. Every project has the
   * atlas server, and the block is what an agent that does not show the server's own text reads, so it
   * does not wait for a per-machine MCP file to exist.
   */
  static merged(opts: {
    root: string;
    config: TResolvedConfig;
  }): { path: string; changed: boolean; text: string } | undefined {
    const path = join(opts.root, 'AGENTS.md');

    if (!existsSync(path)) {
      return undefined;
    }

    const block = AtlasBlock.render({
      project: ProjectManifest.projectNameOf(opts),
      sources: opts.config.atlas.sources.map((source) => source.name),
    });

    return { path, ...AtlasBlock.merge({ text: readFileSync(path, 'utf8'), block }) };
  }

  /** The committed AGENTS.md carries the block for every agent, Claude included. */
  static plan(opts: { root: string; config: TResolvedConfig }): ISyncAction[] {
    const merged = AtlasBlockPlan.merged(opts);

    if (merged === undefined) {
      return [];
    }

    if (!merged.changed) {
      return [{ path: merged.path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }];
    }

    return [
      {
        path: merged.path,
        status: SyncStatuses.REPLACED,
        note: 'Atlas block',
        apply: () => writeFileSync(merged.path, merged.text),
      },
    ];
  }
}
