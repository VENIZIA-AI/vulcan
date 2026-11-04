import type { IBoardViewEvent, IFlowView } from '../common/types.ts';
import { BoardView } from './view.ts';

/** Two agents (or an agent and the owner) and the lines between them. */
export interface IPair {
  a: string;
  b: string;
  last: string;
  evs: IBoardViewEvent[];
}

/** The agents graph: who talked to whom, and where each agent sits. */
export class BoardGraph {
  /**
   * The lines between each two of `names`: a line sent to another agent, the ask that waits on the owner, and the owner's
   * answer to an ask. A line counts once, however it is reached.
   */
  static pairsOf(opts: {
    names: Set<string>;
    owner: string;
    events: IBoardViewEvent[];
    flows: IFlowView[];
  }): Record<string, IPair> {
    const { names, owner } = opts;
    const pairs: Record<string, IPair> = {};
    const add = (from: string, to: string, event: IBoardViewEvent): void => {
      const key = [from, to].sort().join('|');
      const pair = (pairs[key] ??= { a: from, b: to, last: '', evs: [] });

      if (!pair.evs.includes(event)) {
        pair.evs.push(event);
        pair.last = event.ts > pair.last ? event.ts : pair.last;
      }
    };

    for (const event of opts.events) {
      if (event.to && event.actor !== event.to && names.has(event.actor) && names.has(event.to)) {
        add(event.actor, event.to, event);
      }
    }

    for (const view of opts.flows) {
      const ask = view.lastAsk;

      if (view.holder !== owner && ask && view.flow.state === 'you' && names.has(ask.actor)) {
        add(ask.actor, owner, ask);
      }
    }

    for (const event of opts.events) {
      const asked =
        event.kind === 'decision' && event.actor === owner
          ? opts.flows
              .find((view) => view.flow.id === event.flowId)
              ?.evs.find((line) => line.needsOwner)
          : undefined;

      if (asked && names.has(asked.actor)) {
        add(owner, asked.actor, event);
      }
    }

    return pairs;
  }

  /** The owner in the middle, the agents on a ring (wider than tall on a wide screen). */
  static positions(opts: {
    owner: string;
    agents: string[];
    width: number;
    height: number;
  }): Record<string, [number, number]> {
    const { width, height } = opts;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 70;
    const stretch = width > height ? 1.25 : 1;
    const positions: Record<string, [number, number]> = { [opts.owner]: [cx, cy] };

    opts.agents.forEach((name, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / opts.agents.length;

      positions[name] = [cx + radius * Math.cos(angle) * stretch, cy + radius * Math.sin(angle)];
    });

    return positions;
  }

  /** The curve of a line between two points, bowed a little to one side, and where its count goes. */
  static edgeOf(opts: { from: [number, number]; to: [number, number] }): {
    d: string;
    label: [number, number];
  } {
    const [x1, y1] = opts.from;
    const [x2, y2] = opts.to;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const qx = mx - (y2 - y1) * 0.2;
    const qy = my + (x2 - x1) * 0.2;

    return {
      d: `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      label: [(mx + qx) / 2, (my + qy) / 2 - 4],
    };
  }

  static newestFirst(opts: { pair: IPair }): IBoardViewEvent[] {
    return opts.pair.evs.slice().sort(BoardView.byTime).reverse();
  }
}
