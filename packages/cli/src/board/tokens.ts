import type { IEvent } from '../events/common/index.ts';
import { EventKinds } from '../events/common/index.ts';
import type { IBoardTokenRow, IBoardTokens } from './common/index.ts';

const empty = (opts: { name: string }): IBoardTokenRow => ({
  name: opts.name,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

const add = (opts: { row: IBoardTokenRow; line: IEvent }): void => {
  const { row } = opts;

  row.input += opts.line.usage?.input ?? 0;
  row.output += opts.line.usage?.output ?? 0;
  row.cacheRead += opts.line.usage?.cacheRead ?? 0;
  row.cacheWrite += opts.line.usage?.cacheWrite ?? 0;
};

/** The tokens of a flow, summed from the `usage` lines of the log: numbers only, in four counts, by agent and by model. */
export class BoardTokens {
  /** The totals of every flow (`flowId`, or `unflowed` for a line with none), from the lines of the log. */
  static of(opts: { events: IEvent[]; unflowed: string }): Record<string, IBoardTokens> {
    const byFlow = new Map<
      string,
      {
        total: IBoardTokenRow;
        agents: Map<string, IBoardTokenRow>;
        models: Map<string, IBoardTokenRow>;
      }
    >();

    for (const line of opts.events) {
      if (line.kind !== EventKinds.USAGE || line.usage === undefined) {
        continue;
      }

      const id = line.flowId ?? opts.unflowed;
      const entry = byFlow.get(id) ?? {
        total: empty({ name: '' }),
        agents: new Map<string, IBoardTokenRow>(),
        models: new Map<string, IBoardTokenRow>(),
      };
      const agent =
        line.usage.agent === undefined ? line.actor : `${line.actor} (${line.usage.agent})`;
      const agentRow = entry.agents.get(agent) ?? empty({ name: agent });
      const modelRow = entry.models.get(line.usage.model) ?? empty({ name: line.usage.model });

      add({ row: entry.total, line });
      add({ row: agentRow, line });
      add({ row: modelRow, line });
      entry.agents.set(agent, agentRow);
      entry.models.set(line.usage.model, modelRow);
      byFlow.set(id, entry);
    }

    const heaviest = (rows: Map<string, IBoardTokenRow>): IBoardTokenRow[] =>
      [...rows.values()]
        .filter((row) => row.input + row.output + row.cacheRead + row.cacheWrite > 0)
        .sort(
          (left, right) =>
            right.output + right.input - (left.output + left.input) ||
            left.name.localeCompare(right.name),
        );

    return Object.fromEntries(
      [...byFlow.entries()].flatMap(([id, entry]) => {
        const { name: _name, ...counts } = entry.total;
        const total = counts.input + counts.output + counts.cacheRead + counts.cacheWrite;

        return total === 0
          ? []
          : [[id, { ...counts, agents: heaviest(entry.agents), models: heaviest(entry.models) }]];
      }),
    );
  }
}
