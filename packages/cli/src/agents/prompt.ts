import { askWithPrompt } from '../create/names.ts';
import type { IAgentQuestion } from './common/index.ts';
import { AgentConstants } from './common/index.ts';
import { agentIds } from './table.ts';

/** The terminal question: what was detected, what exists, and the developer's earlier choice as the shown default. */
export const askAgentsInTerminal = (question: IAgentQuestion): string | null => {
  const lines = [
    'Which coding agents do you use in this project? (comma-separated, Enter accepts)',
    `  detected: ${question.detected.length === 0 ? '(none)' : question.detected.join(', ')}`,
    ...(question.stored === undefined
      ? []
      : [
          `  chosen before: ${question.stored.length === 0 ? AgentConstants.NONE : question.stored.join(', ')}`,
        ]),
    `  available: ${[...agentIds(), AgentConstants.NONE].join(', ')}`,
  ];

  process.stdout.write(`${lines.join('\n')}\n`);

  return askWithPrompt({ question: 'Agents' });
};
