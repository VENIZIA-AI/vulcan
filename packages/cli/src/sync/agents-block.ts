import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentsList } from '@venizia/vulcan-okf';
import { AtlasBlock, RulesBlock } from '../agents/index.ts';
import { ProjectLayout } from '../common/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { ProjectTmp } from '../hooks/project-tmp.ts';
import { ProjectManifest } from '../manifest/index.ts';
import { BaseRules, RulePacks, RuleParser, RuleSlots } from '../rules/index.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

const AGENTS_FILE = 'AGENTS.md';

const readText = (opts: { file: string }): string =>
  existsSync(opts.file) ? readFileSync(opts.file, 'utf8') : '';

export class AgentsBlockPlan {
  /** The rules block of this project: the base rules and the project's own, the slot choices and the config's often-dropped list. */
  private static rulesBlockOf(opts: { root: string; config: TResolvedConfig }): string {
    return RulesBlock.render({
      rows: [
        ...Object.values(BaseRules.read({ packs: opts.config.packs })),
        ...RuleParser.extractRows({
          markdown: readText({ file: join(opts.root, '.agents', 'rules.md') }),
        }),
      ],
      packs: opts.config.packs.map((name) => ({
        path: RulePacks.pathOf({ name }),
        name,
        ids: Object.keys(RulePacks.rowsOf({ name })),
      })),
      slotLines: RulesBlock.slotLinesOf({
        slots: RuleSlots.read(),
        choices: opts.config.rules,
        command: ProjectLayout.VULCAN_COMMAND,
      }),
      tmp: ProjectTmp.configuredOf({ tmp: opts.config.local.tmp }),
      oftenDropped: opts.config.digest.oftenDropped,
    });
  }

  /**
   * AGENTS.md with the Atlas block and the rules block merged in, or undefined when AGENTS.md is absent. Every
   * project has the atlas server, and the blocks are what an agent that does not show the server's own text, or
   * that no session-start hook reaches, reads, so they do not wait for a per-machine file to exist.
   */
  static merged(opts: {
    root: string;
    config: TResolvedConfig;
  }): { path: string; changed: boolean; text: string } | undefined {
    const path = join(opts.root, AGENTS_FILE);

    if (!existsSync(path)) {
      return undefined;
    }

    const original = readFileSync(path, 'utf8');
    const atlas = AtlasBlock.merge({
      text: original,
      block: AtlasBlock.render({
        project: ProjectManifest.projectNameOf(opts),
        sources: opts.config.atlas.sources.map((source) => source.name),
      }),
    });
    const rules = RulesBlock.merge({
      text: atlas.text,
      block: AgentsBlockPlan.rulesBlockOf(opts),
    });

    // The blocks can make the file long, and a long agent-read file carries a contents list that `okf check --strict` wants fresh.
    const text = opts.config.okf.contents.files.some((pattern) =>
      new Bun.Glob(pattern).match(AGENTS_FILE),
    )
      ? ContentsList.withContents({ text: rules.text })
      : rules.text;

    return { path, changed: text !== original, text };
  }

  /** The committed AGENTS.md carries the blocks for every agent, Claude included. */
  static plan(opts: { root: string; config: TResolvedConfig }): ISyncAction[] {
    const merged = AgentsBlockPlan.merged(opts);

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
        note: 'Atlas and rules blocks',
        apply: () => writeFileSync(merged.path, merged.text),
      },
    ];
  }
}
