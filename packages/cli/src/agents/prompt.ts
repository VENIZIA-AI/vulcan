import { askWithPrompt } from '../create/names.ts';
import { TerminalCapability, TerminalPrompt } from '../ui/index.ts';
import type { IAgentQuestion, TAgentResolution } from './common/index.ts';
import { AgentConstants } from './common/index.ts';
import { AgentSelection } from './resolve.ts';
import { AgentTable } from './table.ts';

const listOf = (opts: { agents: string[] }): string =>
  opts.agents.length === 0 ? AgentConstants.NONE : opts.agents.join(', ');

const hintOf = (opts: { id: string; question: IAgentQuestion }): string | undefined => {
  const notes = [
    ...(opts.question.detected.includes(opts.id) ? ['detected'] : []),
    ...(opts.question.stored?.includes(opts.id) ? ['chosen before'] : []),
  ];

  return notes.length === 0 ? undefined : notes.join(', ');
};

/**
 * The checkbox menu: what this machine chose before is ticked, else what was detected. The first
 * pass of the resolution only learns whether it has to ask; the answer then goes back in as a list,
 * so the order in which sources are tried stays in `resolveAgents`.
 */
const resolveAgentsWithMenu = async (opts: TResolveAgentsInput): Promise<TAgentResolution> => {
  const questions: IAgentQuestion[] = [];
  const first = AgentSelection.resolve({
    ...opts,
    ask: (question) => {
      questions.push(question);

      return '';
    },
  });
  const [question] = questions;

  if (question === undefined) {
    return first;
  }

  const picked = await TerminalPrompt.promptMultiselect({
    message: 'Which coding agents do you use in this project?',
    choices: AgentTable.read().map((entry) => ({
      value: entry.id,
      label: entry.name,
      hint: hintOf({ id: entry.id, question }),
    })),
    initial: question.stored ?? question.detected,
  });

  return AgentSelection.resolve({
    ...opts,
    ask: () => {
      if (picked === null) {
        return null;
      }

      return picked.length === 0 ? AgentConstants.NONE : picked.join(',');
    },
  });
};

export class AgentsPrompt {
  private static askAgentsInTerminal(question: IAgentQuestion): string | null {
    process.stdout.write(`${AgentsPrompt.renderQuestion(question)}\n`);

    return askWithPrompt({ question: 'Agents' });
  }

  /**
   * The question as the terminal shows it. It says exactly what an empty answer does: it keeps the
   * choice stored on this machine when there is one, else it takes what was detected.
   */
  static renderQuestion(question: IAgentQuestion): string {
    const enter =
      question.stored === undefined
        ? `Enter accepts the detected list: ${listOf({ agents: question.detected })}`
        : `Enter keeps your earlier choice: ${listOf({ agents: question.stored })}`;

    return [
      `Which coding agents do you use in this project? (comma-separated; ${enter})`,
      `  detected: ${question.detected.length === 0 ? '(none)' : question.detected.join(', ')}`,
      ...(question.stored === undefined
        ? []
        : [`  chosen before: ${listOf({ agents: question.stored })}`]),
      `  available: ${[...AgentTable.agentIds(), AgentConstants.NONE].join(', ')}`,
    ].join('\n');
  }

  /** Menus in a terminal that can draw them, the plain question everywhere else. */
  static resolveInTerminal(opts: TResolveAgentsInput): Promise<TAgentResolution> {
    return TerminalCapability.menusAvailable()
      ? resolveAgentsWithMenu(opts)
      : Promise.resolve(AgentSelection.resolve({ ...opts, ask: AgentsPrompt.askAgentsInTerminal }));
  }
}

type TResolveAgentsInput = Omit<Parameters<typeof AgentSelection.resolve>[0], 'ask'>;
