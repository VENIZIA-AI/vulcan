import { askWithPrompt } from '../create/names.ts';
import type { IAgentQuestion } from './common/index.ts';
import { AgentConstants } from './common/index.ts';
import { agentIds } from './table.ts';

const listOf = (opts: { agents: string[] }): string =>
  opts.agents.length === 0 ? AgentConstants.NONE : opts.agents.join(', ');

/**
 * The question as the terminal shows it. It says exactly what an empty answer does: it keeps the
 * choice stored on this machine when there is one, else it takes what was detected.
 */
export const renderAgentsQuestion = (question: IAgentQuestion): string => {
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
    `  available: ${[...agentIds(), AgentConstants.NONE].join(', ')}`,
  ].join('\n');
};

export const askAgentsInTerminal = (question: IAgentQuestion): string | null => {
  process.stdout.write(`${renderAgentsQuestion(question)}\n`);

  return askWithPrompt({ question: 'Agents' });
};
