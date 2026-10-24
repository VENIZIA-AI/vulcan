import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from './common/index.ts';
import type { TAgentResolution, TAskAgents } from './common/index.ts';
import { readLocalChoice } from './local.ts';
import { agentIds } from './table.ts';

const PROJECT_FILES = ['CLAUDE.md', '.claude'];

export const NO_TTY_HINT = `vulcan sync: no agents chosen on this machine - wrote the Claude files as before; to choose, run: vulcan sync ${AgentConstants.FLAG} ${AgentConstants.EXAMPLE_LIST} (or ${AgentConstants.NONE})`;

type TParsed = { ok: true; agents: string[] } | { ok: false; error: string };

/** A comma list or `none`: validated against the table, deduplicated, in table order. */
export const parseAgentList = (opts: { value: string }): TParsed => {
  const known = agentIds();
  const words = opts.value
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');

  if (words.includes(AgentConstants.NONE)) {
    return words.length === 1
      ? { ok: true, agents: [] }
      : {
          ok: false,
          error: `vulcan sync: '${AgentConstants.NONE}' cannot be combined with other agents`,
        };
  }

  const unknown = words.find((word) => !known.includes(word));

  if (unknown !== undefined) {
    return {
      ok: false,
      error: `vulcan sync: unknown agent '${unknown}' - one of: ${[...known, AgentConstants.NONE].join(', ')}`,
    };
  }

  return { ok: true, agents: known.filter((id) => words.includes(id)) };
};

const fromList = (opts: { value: string; source: 'flag' | 'asked' }): TAgentResolution => {
  const parsed = parseAgentList({ value: opts.value });

  return parsed.ok
    ? { ok: true, agents: parsed.agents, source: opts.source, writeLocal: true, hint: undefined }
    : parsed;
};

/**
 * Which agents this machine uses, in order: the flag, the stored choice, the committed config's
 * suggestion, a project that already has Claude files, then ask (terminal) or keep today's Claude
 * default (no terminal, with a hint and nothing stored).
 */
export const resolveAgents = (opts: {
  root: string;
  /** `--agents`: undefined when absent, '' when given without a value. */
  flag: string | undefined;
  configAgents: string[] | undefined;
  interactive: boolean;
  detected: string[];
  ask: TAskAgents;
}): TAgentResolution => {
  const stored = readLocalChoice({ root: opts.root });

  if (!stored.ok) {
    return { ok: false, error: `vulcan sync: ${stored.error}` };
  }

  const askNow = (): TAgentResolution => {
    const answer = opts.ask({ detected: opts.detected, stored: stored.agents });

    if (answer === null) {
      return {
        ok: false,
        error: `vulcan sync: no answer - run: vulcan sync ${AgentConstants.FLAG} ${AgentConstants.EXAMPLE_LIST} (or ${AgentConstants.NONE})`,
      };
    }

    // Enter keeps what this machine chose before; with no earlier choice it takes what was detected.
    return answer.trim() === ''
      ? {
          ok: true,
          agents: stored.agents ?? opts.detected,
          source: 'asked',
          writeLocal: true,
          hint: undefined,
        }
      : fromList({ value: answer, source: 'asked' });
  };

  if (opts.flag === '') {
    return opts.interactive
      ? askNow()
      : {
          ok: false,
          error: `vulcan sync: ${AgentConstants.FLAG} needs a list (${AgentConstants.EXAMPLE_LIST}) or ${AgentConstants.NONE}`,
        };
  }

  if (opts.flag !== undefined) {
    return fromList({ value: opts.flag, source: 'flag' });
  }

  if (stored.agents !== undefined) {
    return { ok: true, agents: stored.agents, source: 'local', writeLocal: false, hint: undefined };
  }

  if (opts.configAgents !== undefined) {
    return {
      ok: true,
      agents: agentIds().filter((id) => opts.configAgents?.includes(id)),
      source: 'config',
      writeLocal: true,
      hint: undefined,
    };
  }

  if (PROJECT_FILES.some((file) => existsSync(join(opts.root, file)))) {
    return { ok: true, agents: ['claude'], source: 'migration', writeLocal: true, hint: undefined };
  }

  if (opts.interactive) {
    return askNow();
  }

  return {
    ok: true,
    agents: [AgentConstants.DEFAULT_AGENT],
    source: 'default',
    writeLocal: false,
    hint: NO_TTY_HINT,
  };
};

/** The same order without a terminal or a flag: what doctor and every non-interactive reader use. */
export const resolveAgentsQuietly = (opts: {
  root: string;
  configAgents: string[] | undefined;
}): string[] => {
  const resolved = resolveAgents({
    root: opts.root,
    flag: undefined,
    configAgents: opts.configAgents,
    interactive: false,
    detected: [],
    ask: () => null,
  });

  return resolved.ok ? resolved.agents : [AgentConstants.DEFAULT_AGENT];
};
