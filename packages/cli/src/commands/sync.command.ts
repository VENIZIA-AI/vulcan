import { ProjectTmp } from '../hooks/project-tmp.ts';
import { relative } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { homedir } from 'node:os';
import {
  AgentConstants,
  AgentDetection,
  LocalChoice,
  AgentTable,
  AgentsPrompt,
} from '../agents/index.ts';
import { ConfigLoader } from '../config/index.ts';
import {
  AgentFiles,
  AgentRemoval,
  AgentsBlockPlan,
  BaseRulesDiff,
  ExcludePlan,
  LocalPlan,
  SyncConstants,
  SyncPlanner,
  SyncStatuses,
} from '../sync/index.ts';
import { CommitHookPlan } from '../commit/index.ts';

const DRY_RUN_FLAG = '--dry-run';
const LABEL_WIDTH = 9;

/** Under --dry-run nothing is written, so a write is labelled as what it would do. */
const DRY_RUN_LABELS: Record<string, string> = {
  [SyncStatuses.CREATED]: 'would create',
  [SyncStatuses.REPLACED]: 'would replace',
  [SyncStatuses.REMOVED]: 'would remove',
};
const DRY_RUN_LABEL_WIDTH = Math.max(...Object.values(DRY_RUN_LABELS).map((label) => label.length));

/** `--agents` is undefined when absent and '' when it has no value after it. */
const readAgentsFlag = (opts: { args: string[] }): string | undefined => {
  const index = opts.args.indexOf(AgentConstants.FLAG);

  if (index === -1) {
    return undefined;
  }

  const value = opts.args[index + 1];

  return value === undefined || value.startsWith('--') ? '' : value;
};

export class SyncFlow {
  static printAgentTable(): void {
    for (const entry of AgentTable.read()) {
      process.stdout.write(
        `${entry.id.padEnd(15)} ${entry.name.padEnd(20)} MCP ${entry.mcp.path.padEnd(26)} skills ${entry.skills.dir}\n`,
      );
    }
  }

  /**
   * The whole sync. `cleanup` names agents whose adapters are taken back even when no stored choice
   * says so (`vulcan agents remove`); an agent stored before and left out of a new explicit list is
   * taken back too.
   */
  static async run(opts: ICommandContext & { cleanup?: string[] }): Promise<number> {
    const flag = readAgentsFlag({ args: opts.args });

    if (flag === AgentConstants.LIST) {
      SyncFlow.printAgentTable();

      return ExitCodes.OK;
    }

    const loaded = await ConfigLoader.load({ root: opts.cwd });

    if (!loaded.ok) {
      process.stderr.write(`vulcan sync: ${loaded.error}\n`);

      return ExitCodes.FAILURE;
    }

    const resolved = await AgentsPrompt.resolveInTerminal({
      root: opts.cwd,
      flag,
      configAgents: loaded.config.agents,
      interactive: process.stdin.isTTY === true,
      detected: AgentDetection.detect({
        root: opts.cwd,
        home: process.env.HOME ?? homedir(),
        path: process.env.PATH ?? '',
      }),
    });

    if (!resolved.ok) {
      process.stderr.write(`${resolved.error}\n`);

      return ExitCodes.FAILURE;
    }

    const previous = LocalChoice.read({ root: opts.cwd });
    const dropped =
      resolved.source === 'flag' || resolved.source === 'asked'
        ? (previous.ok ? (previous.agents ?? []) : []).filter((id) => !resolved.agents.includes(id))
        : [];
    const removed = [...new Set([...(opts.cleanup ?? []), ...dropped])].filter(
      (id) => !resolved.agents.includes(id),
    );
    const dryRun = opts.args.includes(DRY_RUN_FLAG);
    // The stored choice is listed whether it was just written or only read; a machine that has not chosen stores nothing.
    const stored =
      resolved.writeLocal || resolved.source === 'local'
        ? [
            LocalPlan.planChoice({ root: opts.cwd, agents: resolved.agents }),
            ...(resolved.writeLocal ? LocalPlan.planIgnore({ root: opts.cwd }) : []),
          ]
        : [];
    const actions = [
      ...AgentRemoval.plan({ root: opts.cwd, removed, remaining: resolved.agents }),
      ...SyncPlanner.plan({ root: opts.cwd, config: loaded.config, agents: resolved.agents }),
      ...AgentsBlockPlan.plan({ root: opts.cwd, config: loaded.config }),
      ...stored,
      ...LocalPlan.planWorkspace({
        root: opts.cwd,
        tmp: ProjectTmp.configuredOf({ tmp: loaded.config.local.tmp }),
      }),
      ...ExcludePlan.plan({ root: opts.cwd, agents: resolved.agents }),
      ...CommitHookPlan.plan({ root: opts.cwd, config: loaded.config }),
    ];
    // Read before the manifest action rewrites the hashes it compares against.
    const changes = BaseRulesDiff.diff({ root: opts.cwd });
    const width = dryRun ? DRY_RUN_LABEL_WIDTH : LABEL_WIDTH;

    for (const action of actions) {
      if (!dryRun) {
        action.apply();
      }

      const note = action.note === undefined ? '' : ` (${action.note})`;
      const label = (dryRun ? DRY_RUN_LABELS[action.status] : undefined) ?? action.status;

      process.stderr.write(`  ${label.padEnd(width)} ${relative(opts.cwd, action.path)}${note}\n`);
    }

    for (const { id, change, text } of changes) {
      process.stderr.write(`  ${change.padEnd(width)} ${[id, text].filter(Boolean).join(' ')}\n`);
    }

    for (const { agent, note } of AgentFiles.agentNotes({ agents: resolved.agents })) {
      process.stderr.write(`  ${'note'.padEnd(width)} ${agent}: ${note}\n`);
    }

    if (resolved.hint !== undefined) {
      process.stderr.write(`${resolved.hint}\n`);
    }

    const settingsBroken = actions.some(
      (action) =>
        action.status === SyncStatuses.SKIPPED && action.path.endsWith(SyncConstants.SETTINGS_FILE),
    );

    return settingsBroken ? ExitCodes.FAILURE : ExitCodes.OK;
  }
}

export const runSyncCommand = async (opts: ICommandContext): Promise<number> => SyncFlow.run(opts);
