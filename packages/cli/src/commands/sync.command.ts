import { ConfigImports } from '../config/imports.ts';
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
const QUIET_FLAG = '--quiet';
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
   * says so (`vulcan agent remove`); an agent stored before and left out of a new explicit list is
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
      process.stderr.write(`vulcan project sync: ${loaded.error}\n`);

      return ExitCodes.FAILURE;
    }

    // The old keys of the profile move to their groups before anything reads the stored choice; a dry run only lists the move (and then
    // the choice, which is still under the old key, is reported as the error that says to run sync).
    const isDryRun = opts.args.includes(DRY_RUN_FLAG);
    const profileMoves = LocalPlan.planProfileKeys({ root: opts.cwd });

    const movedProfile = isDryRun ? LocalPlan.movedProfile({ root: opts.cwd }) : undefined;

    // What the move did, or could not do, is said before anything can fail on the profile.
    for (const move of profileMoves) {
      if (!isDryRun) {
        move.apply();
        process.stderr.write(
          `vulcan project sync: ${relative(opts.cwd, move.path)}: ${move.note ?? 'moved'}\n`,
        );
      }
    }

    const resolved = await AgentsPrompt.resolveInTerminal({
      root: opts.cwd,
      flag,
      configAgents: loaded.config.agents,
      ...(movedProfile === undefined ? {} : { profile: movedProfile }),
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

    const previous = LocalChoice.read({
      root: opts.cwd,
      ...(movedProfile === undefined ? {} : { profile: movedProfile }),
    });
    const dropped =
      resolved.source === 'flag' || resolved.source === 'asked'
        ? (previous.ok ? (previous.agents ?? []) : []).filter((id) => !resolved.agents.includes(id))
        : [];
    const removed = [...new Set([...(opts.cleanup ?? []), ...dropped])].filter(
      (id) => !resolved.agents.includes(id),
    );
    // The stored choice is listed whether it was just written or only read; a machine that has not chosen stores nothing.
    const stored =
      resolved.writeLocal || resolved.source === 'local'
        ? [LocalPlan.planChoice({ root: opts.cwd, agents: resolved.agents })]
        : [];
    // The modules of the config are read once: the manifest records them, and the warnings below name what they leave unprotected.
    const configImports = ConfigImports.scan({ root: opts.cwd });
    const actions = [
      ...AgentRemoval.plan({ root: opts.cwd, removed, remaining: resolved.agents }),
      ...SyncPlanner.plan({
        root: opts.cwd,
        config: loaded.config,
        agents: resolved.agents,
        configModules: configImports.modules,
      }),
      ...AgentsBlockPlan.plan({ root: opts.cwd, config: loaded.config }),
      ...profileMoves.map((move) => (isDryRun ? move : { ...move, apply: () => {} })),
      ...stored,
      ...LocalPlan.planWorkspace({
        root: opts.cwd,
        tmp: ProjectTmp.configuredOf({ tmp: loaded.config.local.tmp }),
      }),
      ...ExcludePlan.plan({ root: opts.cwd, agents: resolved.agents }),
      ...CommitHookPlan.plan({ root: opts.cwd, config: loaded.config }),
    ];
    // Read before the manifest action rewrites the hashes it compares against.
    const changes = BaseRulesDiff.diff({ root: opts.cwd, packs: loaded.config.packs });
    const width = isDryRun ? DRY_RUN_LABEL_WIDTH : LABEL_WIDTH;

    const isQuiet = opts.args.includes(QUIET_FLAG);

    for (const action of actions) {
      if (!isDryRun) {
        action.apply();
      }

      // `--quiet` (the `prepare` script, run on every install) prints what changed, not every file that stayed as it was.
      if (isQuiet && action.status === SyncStatuses.UNCHANGED) {
        continue;
      }

      const note = action.note === undefined ? '' : ` (${action.note})`;
      const label = (isDryRun ? DRY_RUN_LABELS[action.status] : undefined) ?? action.status;

      process.stderr.write(`  ${label.padEnd(width)} ${relative(opts.cwd, action.path)}${note}\n`);
    }

    for (const { id, change, text } of changes) {
      process.stderr.write(`  ${change.padEnd(width)} ${[id, text].filter(Boolean).join(' ')}\n`);
    }

    for (const problem of configImports.problems) {
      process.stderr.write(`  ${'warning'.padEnd(width)} ${problem.file}: ${problem.message}\n`);
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
