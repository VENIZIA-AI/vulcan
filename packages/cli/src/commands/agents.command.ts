import { homedir } from 'node:os';
import {
  AgentConstants,
  agentIds,
  detectAgents,
  parseAgentList,
  resolveAgents,
} from '../agents/index.ts';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { loadConfig } from '../config/index.ts';
import { printAgentTable, runSyncFlow } from './sync.command.ts';

const SUBCOMMANDS = ['list', 'add', 'remove', 'setup'];
const DRY_RUN_FLAG = '--dry-run';

const fail = (opts: { message: string }): number => {
  process.stderr.write(`vulcan agents: ${opts.message}\n`);

  return ExitCodes.FAILURE;
};

const detected = (opts: { root: string }): string[] =>
  detectAgents({
    root: opts.root,
    home: process.env.HOME ?? homedir(),
    path: process.env.PATH ?? '',
  });

/** What this machine uses now: the stored choice, the migration or the config's suggestion; nothing when it never chose. */
const currentAgents = async (opts: {
  root: string;
}): Promise<{ ok: true; agents: string[]; chosen: boolean } | { ok: false; error: string }> => {
  const loaded = await loadConfig({ root: opts.root });

  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }

  const resolved = resolveAgents({
    root: opts.root,
    flag: undefined,
    configAgents: loaded.config.agents,
    interactive: false,
    detected: [],
    ask: () => null,
  });

  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  return resolved.source === 'default'
    ? { ok: true, agents: [], chosen: false }
    : { ok: true, agents: resolved.agents, chosen: true };
};

const runList = async (opts: { root: string }): Promise<number> => {
  const current = await currentAgents(opts);

  if (!current.ok) {
    return fail({ message: current.error });
  }

  const found = detected(opts);

  process.stdout.write(
    `chosen on this machine: ${current.chosen ? current.agents.join(', ') || AgentConstants.NONE : '(nothing yet)'}\n`,
  );
  process.stdout.write(`detected: ${found.length === 0 ? '(none)' : found.join(', ')}\n\n`);
  printAgentTable();

  return ExitCodes.OK;
};

export const runAgentsCommand = async (opts: ICommandContext): Promise<number> => {
  const words = opts.args.filter((arg) => !arg.startsWith('--'));
  const dryRun = opts.args.includes(DRY_RUN_FLAG) ? [DRY_RUN_FLAG] : [];
  const [subcommand = 'list', value] = words;

  if (!SUBCOMMANDS.includes(subcommand)) {
    return fail({
      message: `unknown subcommand '${subcommand}' - one of: ${SUBCOMMANDS.join(', ')}`,
    });
  }

  if (subcommand === 'list') {
    return runList({ root: opts.cwd });
  }

  if (subcommand === 'setup') {
    if (process.stdin.isTTY !== true) {
      return fail({
        message: `setup asks questions and needs a terminal - without one use 'vulcan agents add|remove <ids>' or 'vulcan sync ${AgentConstants.FLAG} <list>'`,
      });
    }

    return runSyncFlow({ cwd: opts.cwd, args: [AgentConstants.FLAG, ...dryRun] });
  }

  if (value === undefined) {
    return fail({
      message: `${subcommand} needs the agents to ${subcommand} (${AgentConstants.EXAMPLE_LIST})`,
    });
  }

  const parsed = parseAgentList({ value });

  if (!parsed.ok) {
    return fail({ message: parsed.error.replace(/^vulcan sync: /, '') });
  }

  if (parsed.agents.length === 0) {
    return fail({ message: `${subcommand} needs agents, not '${AgentConstants.NONE}'` });
  }

  const current = await currentAgents({ root: opts.cwd });

  if (!current.ok) {
    return fail({ message: current.error });
  }

  const known = agentIds();
  const already = parsed.agents.filter((id) => current.agents.includes(id));
  const absent = parsed.agents.filter((id) => !current.agents.includes(id));
  const touched = subcommand === 'add' ? absent : already;
  const skipped = subcommand === 'add' ? already : absent;

  if (skipped.length > 0) {
    process.stderr.write(
      `vulcan agents: ${subcommand === 'add' ? 'already chosen' : 'not chosen'}: ${skipped.join(', ')}\n`,
    );
  }

  if (touched.length === 0) {
    return ExitCodes.OK;
  }

  const next = known.filter((id) =>
    subcommand === 'add'
      ? [...current.agents, ...touched].includes(id)
      : current.agents.includes(id) && !touched.includes(id),
  );

  return runSyncFlow({
    cwd: opts.cwd,
    args: [
      AgentConstants.FLAG,
      next.length === 0 ? AgentConstants.NONE : next.join(','),
      ...dryRun,
    ],
    cleanup: subcommand === 'remove' ? touched : [],
  });
};
