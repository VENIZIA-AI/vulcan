import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../common/constants.ts';
import { GitQueries } from '../hooks/git-queries.ts';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventKinds } from './common/index.ts';
import type { TIsOver } from './common/index.ts';
import { FlowId } from './flow-id.ts';
import { EventText } from './text.ts';
import { SessionFlow } from './session-flow.ts';
import type { ISessionFlow } from './session-flow.ts';
import { SessionMark } from './session-mark.ts';
import { EventSettings } from './settings.ts';

/** Whether a tracked file of the project was modified after a time (milliseconds). */
type TEdited = (opts: { root: string; since: number }) => boolean;

/** The kinds that are work on a flow: usage and session lines say nothing of it. */
const WORK_KINDS = new Set<string>([
  EventKinds.FLOW,
  EventKinds.COMMIT,
  EventKinds.PR,
  EventKinds.DECISION,
  EventKinds.DEPLOY,
]);

/**
 * The `Stop` hook: it holds the end of a turn once when the board is out of step with the work of the turn, and says
 * the one `vulcan flow step --next` command that puts it right. Out of step means, for the flow of the session (the
 * branch's, else the one it last opened or updated, and not over), that since the flow's last `flow` line the session
 * committed or opened a pull request, or an edit tool of the session ran on tracked files more than `EDIT_HOLD_MS`
 * after that line, or a pull request of the flow was merged while steps are still open. It never blocks twice in a turn (`stop_hook_active`), never
 * with `events.log` off, and any problem reading the log, the edit mark, the clock or git is no block.
 */
export class BoardStop {
  /** The JSON the hook prints to hold the turn, or `undefined` to let it end. */
  static decide(opts: {
    root: string;
    input: unknown;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    edited?: TEdited;
    now?: number;
  }): { decision: 'block'; reason: string } | undefined {
    const { input } = opts;

    if (!RecordValue.isRecord(input) || input.stop_hook_active === true) {
      return undefined;
    }

    const found = SessionFlow.of({
      root: opts.root,
      input,
      env: opts.env,
      isOver: opts.isOver,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });

    if (found === undefined) {
      return undefined;
    }

    const { actor, key, known, flowId, last } = found;

    const since = Date.parse(last.ts);
    const wanted = FlowId.canon({ id: flowId, key });
    const acts = known.filter(
      (event) =>
        event.actor === actor &&
        (event.kind === EventKinds.COMMIT || event.kind === EventKinds.PR) &&
        event.flowId !== undefined &&
        FlowId.canon({ id: event.flowId, key }) === wanted &&
        Date.parse(event.ts) > since,
    );
    const open = (last.steps ?? []).filter((step) => !step.done);
    const isMerged = acts.some((event) => event.summary === EventConstants.PR_MERGE_LABEL);
    const edited = opts.edited ?? BoardStop.editedSince;

    if (isMerged && open.length > 0) {
      return {
        decision: 'block',
        reason: BoardStop.reasonOf({ flow: flowId }),
      };
    }

    const isInFlow = known.some(
      (event) =>
        event.actor === actor &&
        event.flowId !== undefined &&
        FlowId.canon({ id: event.flowId, key }) === wanted,
    );
    // The working tree is shared by every session of a checkout: a dirty file counts only after an edit tool of this session ran.
    const ownEdit = SessionMark.read({
      dir: EventSettings.dirOf({ root: opts.root }),
      folder: EventConstants.OWN_EDIT_DIR,
      actor,
    });
    const isEdited =
      isInFlow &&
      ownEdit !== undefined &&
      ownEdit - since > EventConstants.EDIT_HOLD_MS &&
      edited({ root: opts.root, since });

    if (acts.length > 0 || isEdited) {
      return {
        decision: 'block',
        reason: BoardStop.reasonOf({ flow: flowId }),
      };
    }

    return BoardStop.staleHold({ ...opts, found, open, isInFlow, wanted });
  }

  /**
   * A flow of this session with open steps and no line of work (a flow, commit, pull request, decision or deploy line, by
   * anyone) for `STALE_FLOW_MS` holds the turn once, and then not again for `STALE_FLOW_MS` for this session: the time of the
   * reminder is kept in a small file of the events folder, because the hook writes no line to the log.
   */
  private static staleHold(opts: {
    root: string;
    now?: number;
    found: ISessionFlow;
    open: { text: string }[];
    isInFlow: boolean;
    wanted: string;
  }): { decision: 'block'; reason: string } | undefined {
    const { actor, key, known, flowId, last } = opts.found;
    const now = opts.now ?? Date.now();

    if (opts.open.length === 0 || !opts.isInFlow) {
      return undefined;
    }

    const newest = known
      .filter(
        (event) =>
          WORK_KINDS.has(event.kind) &&
          event.flowId !== undefined &&
          FlowId.canon({ id: event.flowId, key }) === opts.wanted,
      )
      .reduce((latest, event) => Math.max(latest, Date.parse(event.ts)), Date.parse(last.ts));

    if (now - newest < EventConstants.STALE_FLOW_MS) {
      return undefined;
    }

    const dir = EventSettings.dirOf({ root: opts.root });
    const before = SessionMark.read({ dir, folder: EventConstants.STALE_REMINDER_DIR, actor });

    if (before !== undefined && now - before < EventConstants.STALE_FLOW_MS) {
      return undefined;
    }

    try {
      SessionMark.write({ dir, folder: EventConstants.STALE_REMINDER_DIR, actor, now });
      SessionMark.prune({ dir, folder: EventConstants.STALE_REMINDER_DIR, now });
      SessionMark.prune({ dir, folder: EventConstants.OWN_EDIT_DIR, now });
    } catch {
      // A reminder that cannot be remembered would repeat every turn: no reminder.
      return undefined;
    }

    return {
      decision: 'block',
      reason: BoardStop.reasonOf({ flow: flowId }),
    };
  }

  private static reasonOf(opts: { flow: string }): string {
    const command = `${ProjectLayout.VULCAN_COMMAND} flow step --flow ${EventText.shellQuote({ text: opts.flow })}`;

    return `The board is out of step for ${opts.flow}: run ${command} --next '<what is done, what comes next>'`;
  }

  /**
   * Whether a tracked file of the project was modified after `since` (milliseconds): one inert `git diff` (`GitQueries`: no
   * file system monitor, no filter, no inherited `GIT_DIR`, no lock) and a stat of each path. A failure reads as no edit.
   */
  static editedSince(opts: { root: string; since: number }): boolean {
    const names = GitQueries.run({
      args: ['diff', '--name-only', '--relative', 'HEAD'],
      cwd: opts.root,
    });

    return (
      names !== undefined &&
      names
        .split('\n')
        .filter((path) => path !== '')
        .some((path) => {
          try {
            return statSync(join(opts.root, path)).mtimeMs > opts.since;
          } catch {
            return false;
          }
        })
    );
  }
}
