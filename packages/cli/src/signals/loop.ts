import { SignalConstants } from './constants.ts';
import type { ISignalEvent } from './state.ts';

/**
 * What the last calls look like when an agent is going round in circles: the same call three times within
 * a minute, two calls alternating for three rounds, or one call failing again and again. `undefined` when nothing looks stuck.
 */
export const loopOf = (opts: { events: ISignalEvent[] }): string | undefined => {
  const { events } = opts;
  const last = events.slice(-SignalConstants.SAME_CALL_LIMIT);
  const first = last[0];

  if (
    first !== undefined &&
    last.length === SignalConstants.SAME_CALL_LIMIT &&
    last.every((event) => event.key === first.key) &&
    (last.at(-1)?.at ?? 0) - first.at < SignalConstants.POLL_WINDOW_MS
  ) {
    return `the same ${first.tool} call ${SignalConstants.SAME_CALL_LIMIT} times in a row`;
  }

  const cycle = events.slice(-SignalConstants.ALTERNATION_LENGTH);
  const [one, two] = cycle;

  if (
    cycle.length === SignalConstants.ALTERNATION_LENGTH &&
    one !== undefined &&
    two !== undefined &&
    one.key !== two.key &&
    cycle.every((event, index) => event.key === (index % 2 === 0 ? one.key : two.key))
  ) {
    return `${one.tool} and ${two.tool} calls alternating without progress`;
  }

  const recent = events.slice(-SignalConstants.FAILURE_WINDOW);

  for (const key of new Set(recent.map((event) => event.key))) {
    const failures = recent.filter((event) => event.key === key && !event.isOk);

    if (failures.length >= SignalConstants.FAILURE_LIMIT) {
      return `${failures[0]?.tool ?? 'a tool'} failing ${SignalConstants.FAILURE_LIMIT} times with the same input in the last ${SignalConstants.FAILURE_WINDOW} calls`;
    }
  }

  return undefined;
};
