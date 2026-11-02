import { AgentConstants, AgentSources } from './common/index.ts';
import type { TAgentResolution, TAskAgents } from './common/index.ts';
import { LocalChoice } from './local.ts';
import { AgentTable } from './table.ts';

export const NO_TTY_HINT = `vulcan sync: no agents chosen on this machine - wrote the Claude files as before; to choose, run: vulcan sync ${AgentConstants.FLAG} ${AgentConstants.EXAMPLE_LIST} (or ${AgentConstants.NONE})`;

type TParsed = { ok: true; agents: string[] } | { ok: false; error: string };

export class AgentSelection {
  private static fromList(opts: {
    value: string;
    source: typeof AgentSources.FLAG | typeof AgentSources.ASKED;
  }): TAgentResolution {
    const parsed = AgentSelection.parseList({ value: opts.value });

    return parsed.ok
      ? { ok: true, agents: parsed.agents, source: opts.source, writeLocal: true, hint: undefined }
      : parsed;
  }

  /** A comma list or `none`: validated against the table, deduplicated, in table order. */
  static parseList(opts: { value: string }): TParsed {
    const known = AgentTable.agentIds();
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
  }

  /**
   * Which agents this machine uses, in order: the flag, the stored choice, the committed config's
   * suggestion, then ask (terminal) or the Claude default (no terminal, with a hint and nothing stored).
   */
  static resolve(opts: {
    root: string;
    /** `--agents`: undefined when absent, '' when given without a value. */
    flag: string | undefined;
    configAgents: string[] | undefined;
    interactive: boolean;
    detected: string[];
    ask: TAskAgents;
  }): TAgentResolution {
    const stored = LocalChoice.read({ root: opts.root });

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
            source: AgentSources.ASKED,
            writeLocal: true,
            hint: undefined,
          }
        : AgentSelection.fromList({ value: answer, source: AgentSources.ASKED });
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
      return AgentSelection.fromList({ value: opts.flag, source: AgentSources.FLAG });
    }

    if (stored.agents !== undefined) {
      return {
        ok: true,
        agents: stored.agents,
        source: AgentSources.LOCAL,
        writeLocal: false,
        hint: undefined,
      };
    }

    if (opts.configAgents !== undefined) {
      return {
        ok: true,
        agents: AgentTable.agentIds().filter((id) => opts.configAgents?.includes(id)),
        source: AgentSources.CONFIG,
        writeLocal: true,
        hint: undefined,
      };
    }

    if (opts.interactive) {
      return askNow();
    }

    return {
      ok: true,
      agents: [AgentConstants.DEFAULT_AGENT],
      source: AgentSources.DEFAULT,
      writeLocal: false,
      hint: NO_TTY_HINT,
    };
  }

  /** The same order without a terminal or a flag: what doctor and every non-interactive reader use. */
  static resolveQuietly(opts: { root: string; configAgents: string[] | undefined }): string[] {
    const resolved = AgentSelection.resolve({
      root: opts.root,
      flag: undefined,
      configAgents: opts.configAgents,
      interactive: false,
      detected: [],
      ask: () => null,
    });

    return resolved.ok ? resolved.agents : [AgentConstants.DEFAULT_AGENT];
  }
}
