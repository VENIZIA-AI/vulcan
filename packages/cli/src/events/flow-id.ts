import { closeSync, mkdirSync, openSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventConstants } from './common/index.ts';
import type { IEvent } from './common/index.ts';
import { EventLog } from './log.ts';

/** The number of a flow id of either format: `VULZ-ACME-15` or the older `F-15`. */
const NUMBER = /-(\d+)$/;

/** Flow ids: `VULZ-<key>-<number>`, the number given by VULCAN from a counter beside the log. */
export class FlowId {
  /** The id as the board shows it: an older `F-n` becomes `VULZ-<key>-n`; with no key it stays. */
  static canon(opts: { id: string; key?: string }): string {
    return opts.key !== undefined && EventConstants.FLOW_LEGACY.test(opts.id)
      ? `${EventConstants.FLOW_PREFIX}-${opts.key}-${opts.id.slice(2)}`
      : opts.id;
  }

  /** The number inside an id of either format, or 0. */
  static numberOf(opts: { id: string }): number {
    const number = Number(NUMBER.exec(opts.id)?.[1] ?? 0);

    return Number.isSafeInteger(number) ? number : 0;
  }

  /** The ids the lines carry, newest first, in the form the board shows them. */
  static recent(opts: { events: IEvent[]; key?: string; count: number }): string[] {
    const seen = new Set<string>();

    for (const event of [...opts.events].reverse()) {
      if (event.flowId !== undefined) {
        seen.add(FlowId.canon({ id: event.flowId, key: opts.key }));
      }

      if (seen.size >= opts.count) {
        break;
      }
    }

    return [...seen];
  }

  /** Whether any line of the log carries the flow, under either name of it. */
  static exists(opts: { events: IEvent[]; id: string; key?: string }): boolean {
    const wanted = FlowId.canon({ id: opts.id, key: opts.key });

    return opts.events.some(
      (event) =>
        event.flowId !== undefined && FlowId.canon({ id: event.flowId, key: opts.key }) === wanted,
    );
  }

  /**
   * The next id for `key`. A number is claimed by creating the file `.flow-ids/<key>-<number>` beside the day files with
   * `wx`, which only one process can do for a number: two processes never get the same id, and nothing is locked, so
   * nothing can be left locked by a crash. The search starts above the highest number the log holds for the key (an older
   * `F-n` counts) and above every claim already made, so a number is not given twice even after the retention dropped the
   * day it was on; a claim that exists sends the search on to the next number.
   */
  static next(opts: { dir: string; key: string }): string {
    const claims = join(opts.dir, EventConstants.FLOW_CLAIM_DIR);
    const prefix = `${EventConstants.FLOW_PREFIX}-${opts.key}-`;

    mkdirSync(claims, { recursive: true });

    const logged = EventLog.read({ dir: opts.dir }).events.flatMap((event) =>
      event.flowId !== undefined &&
      (event.flowId.startsWith(prefix) || EventConstants.FLOW_LEGACY.test(event.flowId))
        ? [FlowId.numberOf({ id: event.flowId })]
        : [],
    );
    const claimed = readdirSync(claims)
      .filter((name) => name.startsWith(`${opts.key}-`))
      .map((name) => FlowId.numberOf({ id: name }))
      .filter((number) => number > 0);

    for (let number = Math.max(0, ...logged, ...claimed) + 1; ; number++) {
      try {
        closeSync(openSync(join(claims, `${opts.key}-${number}`), 'wx'));

        return `${prefix}${number}`;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }
}
