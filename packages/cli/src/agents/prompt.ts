import { askWithPrompt } from '../create/names.ts';
import { menusAvailable, promptMultiselect } from '../ui/index.ts';
import type { IAgentQuestion, TAgentResolution } from './common/index.ts';
import { AgentConstants } from './common/index.ts';
import { resolveAgents } from './resolve.ts';
import { agentIds, readAgentTable } from './table.ts';

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

export type TResolveAgentsInput = Omit<Parameters<typeof resolveAgents>[0], 'ask'>;

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
  const first = resolveAgents({
    ...opts,
    ask: question => {
      questions.push(question);

      return '';
    },
  });
  const [question] = questions;

  if (question === undefined) {
    return first;
  }

  const picked = await promptMultiselect({
    message: 'Which coding agents do you use in this project?',
    choices: readAgentTable().map(entry => ({
      value: entry.id,
      label: entry.name,
      hint: hintOf({ id: entry.id, question }),
    })),
    initial: question.stored ?? question.detected,
  });

  return resolveAgents({
    ...opts,
    ask: () => {
      if (picked === null) {
        return null;
      }

      return picked.length === 0 ? AgentConstants.NONE : picked.join(',');
    },
  });
};

/** Menus in a terminal that can draw them, the plain question everywhere else. */
export const resolveAgentsInTerminal = (opts: TResolveAgentsInput): Promise<TAgentResolution> =>
  menusAvailable()
    ? resolveAgentsWithMenu(opts)
    : Promise.resolve(resolveAgents({ ...opts, ask: askAgentsInTerminal }));
