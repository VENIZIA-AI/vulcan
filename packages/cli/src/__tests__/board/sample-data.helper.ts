import type { IBoardData } from '../../board/common/index.ts';
import { BoardFold } from '../../board/fold.ts';
import { sampleLines } from './log-lines.helper.ts';

/** The data of the sample day, with the ids made from the times so that nothing changes between runs. */
export const sampleData = (opts: { base?: number } = {}): IBoardData => {
  const log = BoardFold.fromLog({ events: sampleLines(opts) });
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: 'Ana' });
  const idOf = (event: { flowId: string; ts: string; kind: string }): string =>
    `${event.flowId}:${event.ts}:${event.kind}`;

  return {
    title: 'Acme Board',
    owner: 'Ana',
    key: 'acme',
    shapes: {},
    generatedAt: '2026-11-03T10:00:00.000Z',
    since: '2026-10-27T10:00:00.000Z',
    flows: flows.map((flow) => {
      const events = flow.events.map((event) => ({ ...event, id: idOf(event) }));
      const ask = flow.events.find((event) => event.needsOwner === true);
      const last = events.at(-1);

      return {
        ...flow,
        events,
        lastId: last === undefined ? flow.lastId : last.id,
        ...(ask === undefined ? {} : { askId: idOf(ask) }),
      };
    }),
    decisions,
    agents: log.agents,
    sources: ['event log: 18 line(s) in .agents/local/events', 'github: left out (--no-github)'],
  };
};
