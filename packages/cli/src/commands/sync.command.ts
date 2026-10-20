import { relative } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { homedir } from 'node:os';
import {
  AgentConstants,
  askAgentsInTerminal,
  detectAgents,
  readLocalChoice,
  readAgentTable,
  resolveAgents,
} from '../agents/index.ts';
import { loadConfig } from '../config/index.ts';
import {
  agentNotes,
  diffBaseRules,
  planAgentRemoval,
  planAtlasBlock,
  planExclude,
  planLocalChoice,
  planLocalIgnore,
  planPrune,
  planSync,
  SyncConstants,
  SyncStatuses,
} from '../sync/index.ts';

const DRY_RUN_FLAG = '--dry-run';
const PRUNE_FLAG = '--prune';
const LABEL_WIDTH = 9;

/** Under --dry-run nothing is written, so a write is labelled as what it would do. */
const DRY_RUN_LABELS: Record<string, string> = {
  [SyncStatuses.CREATED]: 'would create',
  [SyncStatuses.REPLACED]: 'would replace',
  [SyncStatuses.REMOVED]: 'would remove',
};
const DRY_RUN_LABEL_WIDTH = Math.max(...Object.values(DRY_RUN_LABELS).map(label => label.length));

/** `--agents` is undefined when absent and '' when it has no value after it. */
const readAgentsFlag = (opts: { args: string[] }): string | undefined => {
  const index = opts.args.indexOf(AgentConstants.FLAG);

  if (index === -1) {
    return undefined;
  }

  const value = opts.args[index + 1];

  return value === undefined || value.startsWith('--') ? '' : value;
};

export const printAgentTable = (): void => {
  for (const entry of readAgentTable()) {
    process.stdout.write(
      `${entry.id.padEnd(15)} ${entry.name.padEnd(20)} MCP ${entry.mcp.path.padEnd(26)} skills ${entry.skills.dir}\n`,
    );
  }
};

/**
 * The whole sync. `cleanup` names agents whose adapters are taken back even when no stored choice
 * says so (`vulcan agents remove`); an agent stored before and left out of a new explicit list is
 * taken back too.
 */
export const runSyncFlow = async (
  opts: ICommandContext & { cleanup?: string[] },
): Promise<number> => {
  const flag = readAgentsFlag({ args: opts.args });

  if (flag === AgentConstants.LIST) {
    printAgentTable();

    return ExitCodes.OK;
  }

  const loaded = await loadConfig({ root: opts.cwd });

  if (!loaded.ok) {
    process.stderr.write(`vulcan sync: ${loaded.error}\n`);

    return ExitCodes.FAILURE;
  }

  const resolved = resolveAgents({
    root: opts.cwd,
    flag,
    configAgents: loaded.config.agents,
    interactive: process.stdin.isTTY === true,
    detected: detectAgents({
      root: opts.cwd,
      home: process.env.HOME ?? homedir(),
      path: process.env.PATH ?? '',
    }),
    ask: askAgentsInTerminal,
  });

  if (!resolved.ok) {
    process.stderr.write(`${resolved.error}\n`);

    return ExitCodes.FAILURE;
  }

  const previous = readLocalChoice({ root: opts.cwd });
  const dropped =
    resolved.source === 'flag' || resolved.source === 'asked'
      ? (previous.ok ? (previous.agents ?? []) : []).filter(id => !resolved.agents.includes(id))
      : [];
  const removed = [...new Set([...(opts.cleanup ?? []), ...dropped])].filter(
    id => !resolved.agents.includes(id),
  );
  const dryRun = opts.args.includes(DRY_RUN_FLAG);
  // Planned before anything is written: prune reads the managed record of the previous sync.
  const pruned = opts.args.includes(PRUNE_FLAG) ? planPrune({ root: opts.cwd }) : [];
  // The stored choice is listed whether it was just written or only read; a machine that has not chosen stores nothing.
  const stored =
    resolved.writeLocal || resolved.source === 'local'
      ? [
          planLocalChoice({ root: opts.cwd, agents: resolved.agents }),
          ...(resolved.writeLocal ? planLocalIgnore({ root: opts.cwd }) : []),
        ]
      : [];
  const actions = [
    ...planAgentRemoval({ root: opts.cwd, removed, remaining: resolved.agents }),
    ...planSync({ root: opts.cwd, config: loaded.config, agents: resolved.agents }),
    ...planAtlasBlock({ root: opts.cwd, config: loaded.config }),
    ...stored,
    ...planExclude({ root: opts.cwd, agents: resolved.agents }),
    ...pruned,
  ];
  // Read before the manifest action rewrites the hashes it compares against.
  const changes = diffBaseRules({ root: opts.cwd });
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

  for (const { agent, note } of agentNotes({ agents: resolved.agents })) {
    process.stderr.write(`  ${'note'.padEnd(width)} ${agent}: ${note}\n`);
  }

  if (resolved.hint !== undefined) {
    process.stderr.write(`${resolved.hint}\n`);
  }

  const settingsBroken = actions.some(
    action =>
      action.status === SyncStatuses.SKIPPED && action.path.endsWith(SyncConstants.SETTINGS_FILE),
  );

  return settingsBroken ? ExitCodes.FAILURE : ExitCodes.OK;
};

export const runSyncCommand = async (opts: ICommandContext): Promise<number> => runSyncFlow(opts);
