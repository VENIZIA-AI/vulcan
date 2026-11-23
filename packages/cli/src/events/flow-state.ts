import { BoardStates } from '../board/common/index.ts';
import { BoardFold } from '../board/fold.ts';
import type { IEvent } from './common/index.ts';
import { FlowId } from './flow-id.ts';

/** What the board says of a flow, asked of the log. It reaches the board's fold, so the event hook loads it only when it needs it. */
export class FlowState {
  /**
   * Whether the board would show the flow as Done or Parked: the board's own fold decides, so the command, the hooks
   * and the page cannot disagree. A merge only the GitHub reader sees is not in the log, so it is not seen here.
   */
  static isOver(opts: { events: IEvent[]; flowId: string; key?: string }): boolean {
    const wanted = FlowId.canon({ id: opts.flowId, key: opts.key });
    const lines = BoardFold.fromLog({ events: opts.events }).events.map((event) => ({
      ...event,
      flowId: FlowId.canon({ id: event.flowId, key: opts.key }),
    }));
    const state = BoardFold.fold({ events: lines, owner: '' }).flows.find(
      (flow) => flow.id === wanted,
    )?.state;

    return state === BoardStates.DONE || state === BoardStates.PARKED;
  }
}
