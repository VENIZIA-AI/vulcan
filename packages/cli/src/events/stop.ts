import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventKinds } from './common/index.ts';
import type { IEvent } from './common/index.ts';
import { EventActor } from './actor.ts';
import { EventFlow } from './flow.ts';
import { FlowId } from './flow-id.ts';
import { FlowSteps } from './flow-steps.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';

type TIsOver = (opts: { events: IEvent[]; flowId: string; key?: string }) => boolean;
/** The tracked files changed since a time: their paths, relative to the project. */
type TEdited = (opts: { root: string; since: number }) => boolean;

/** The most open steps the reason lists as ready commands. */
const STEPS_LISTED = 5;

const shellQuote = (opts: { text: string }): string => `'${opts.text.replaceAll("'", "'\\''")}'`;

/**
 * The `Stop` hook: it holds the end of a turn once when the board is out of step with the work of the turn, and says
 * the exact `vulcan event step` command that puts it right. Out of step means, for the flow of the session (the
 * branch's, else the one it last opened or updated, and not over), that since the flow's last `flow` line the session
 * committed or opened a pull request, or tracked files were edited, or a pull request of the flow was merged while steps
 * are still open. It never blocks twice in a turn (`stop_hook_active`), never with `events.log` off, and any problem
 * reading the log, the clock or git is no block.
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

    const settings = EventSettings.read({ root: opts.root });

    if (!settings.log) {
      return undefined;
    }

    const actor = EventActor.resolve({
      sessionId: typeof input.session_id === 'string' ? input.session_id : undefined,
      env: opts.env,
    });

    if (actor === EventConstants.UNKNOWN_ACTOR) {
      return undefined;
    }

    const key = EventSettings.keyOf({ root: opts.root });
    const known = EventLog.read({
      dir: EventSettings.dirOf({ root: opts.root, settings }),
      since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
    }).events;
    const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : opts.root;
    const flowId =
      EventFlow.fromBranch({ cwd }) ??
      FlowSteps.lastOpenedBy({
        events: known,
        actor,
        isOver: (id) => opts.isOver({ events: known, flowId: id, key }),
      });
    const last =
      flowId === undefined ? undefined : FlowSteps.lastLine({ events: known, flowId, key });

    if (flowId === undefined || last === undefined || opts.isOver({ events: known, flowId, key })) {
      return undefined;
    }

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
        reason: BoardStop.reasonOf({
          flow: flowId,
          title: last.summary,
          open,
          why: 'A pull request of this flow was merged and steps are still open. Tick each step that is done, or say what is left',
        }),
      };
    }

    if (acts.length > 0 || edited({ root: opts.root, since })) {
      return {
        decision: 'block',
        reason: BoardStop.reasonOf({
          flow: flowId,
          title: last.summary,
          open,
          why: 'This turn committed, opened a pull request or edited tracked files, and the flow has had no update since',
        }),
      };
    }

    return undefined;
  }

  private static reasonOf(opts: {
    flow: string;
    title: string;
    open: { text: string }[];
    why: string;
  }): string {
    const command = `${ProjectLayout.VULCAN_COMMAND} event step --flow ${opts.flow}`;
    const shown = opts.open.slice(0, STEPS_LISTED);

    return [
      `The board is out of step: flow ${opts.flow} (${opts.title}). ${opts.why}.`,
      'Run what applies, then finish your turn:',
      ...shown.map((step) => `  ${command} --done ${shellQuote({ text: step.text })}`),
      ...(opts.open.length > shown.length
        ? [`  (${opts.open.length - shown.length} more open steps are in the flow)`]
        : []),
      `  ${command} --next ${shellQuote({ text: 'where the work stands and what comes next' })}`,
    ].join('\n');
  }

  /** Whether a tracked file of the project was modified after `since` (milliseconds): one `git diff` and a stat of each path. A failure reads as no edit. */
  static editedSince(opts: { root: string; since: number }): boolean {
    try {
      const diff = spawnSync('git', ['diff', '--name-only', '--relative', 'HEAD'], {
        cwd: opts.root,
        encoding: 'utf8',
        timeout: EventConstants.STOP_GIT_TIMEOUT_MS,
      });

      return (
        diff.status === 0 &&
        diff.stdout
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
    } catch {
      return false;
    }
  }
}
