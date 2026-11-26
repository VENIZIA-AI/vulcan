import { ProjectLayout } from '../common/constants.ts';
import { EventActor } from '../events/actor.ts';
import { EventConstants, GitActivities } from '../events/common/index.ts';
import type { TIsOver } from '../events/common/index.ts';
import { EventFlow } from '../events/flow.ts';
import { FlowSteps } from '../events/flow-steps.ts';
import { EventLog } from '../events/log.ts';
import { EventSettings } from '../events/settings.ts';
import { GuardDecisions } from './common/index.ts';
import type { IGitHit } from './common/index.ts';
import { GitActivity } from './git-activity.ts';

/**
 * V-P-13, held by the git guard: in a project that logs events, `git commit`, `gh pr create` and `glab mr create` are
 * refused when no flow can be found for the work, and the reason says how to name or make one. A flow is found when the
 * branch names it (`feature/VULZ-ACME-12-...`), when the command carries `Flow: <id>` (in `-m` or a heredoc message or
 * a body given inline; the contents of `-F` or `--body-file` are not read), or when this session (its id, never its
 * name) last opened or updated one in the last three days that is not over; a hook with no session id goes by the actor
 * name instead. Not asked about: a line that works in another repository (`git -C`, `cd`, `gh -R`: the branch and the
 * rule here are not that repository's), a commit `--amend` (it adds no new work), a commit that concludes a merge
 * (`MERGE_HEAD`), and a session whose name is not known (no session id and no `VULCAN_ACTOR`: every such agent would
 * share one identity). It fails open: a log, a manifest or a clock that cannot be read is no refusal, and with
 * `events.log` off, or no `project.key` to make a flow with, the rule does not exist.
 */
export class FlowGuard {
  static inspect(opts: {
    root: string;
    command: string;
    cwd: string | undefined;
    sessionId?: string;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    now?: number;
  }): IGitHit[] {
    try {
      const settings = EventSettings.read({ root: opts.root });

      if (!settings.log) {
        return [];
      }

      const detail = GitActivity.describe({ command: opts.command });

      if (
        detail === undefined ||
        (detail.activity !== GitActivities.COMMIT && detail.activity !== GitActivities.PR_OPEN) ||
        detail.isElsewhere ||
        detail.isAmend ||
        EventConstants.FLOW_LINE.test(opts.command)
      ) {
        return [];
      }

      // A project that logs events but has no `project.key` cannot make a flow (`vulcan flow add` refuses): the
      // rule would ask for what cannot be done, so it does not exist until the key is set. Read only for a commit or a pull request.
      const key = EventSettings.keyOf({ root: opts.root });
      const cwd = opts.cwd ?? opts.root;
      const actor = EventActor.resolve({ sessionId: opts.sessionId, env: opts.env });

      if (
        key === undefined ||
        actor === EventConstants.UNKNOWN_ACTOR ||
        EventFlow.isMerging({ cwd })
      ) {
        return [];
      }

      const known = EventLog.read({
        dir: EventSettings.dirOf({ root: opts.root, settings }),
        since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
      }).events;

      const isOver = (flowId: string): boolean => opts.isOver({ events: known, flowId, key });
      const found =
        FlowSteps.flowOf({ events: known, cwd, session: opts.sessionId, isOver }) ??
        (opts.sessionId === undefined || opts.sessionId === ''
          ? FlowSteps.lastOpenedByActor({ events: known, actor, isOver })
          : undefined);

      if (found !== undefined) {
        return [];
      }

      const looked =
        opts.sessionId === undefined || opts.sessionId === ''
          ? `the actor name '${actor}' has`
          : 'this session has';

      return [
        {
          decision: GuardDecisions.DENY,
          rule: 'V-P-13',
          message: `${detail.activity === GitActivities.COMMIT ? 'a commit' : 'a pull request'} with no flow: the branch does not name one and ${looked} no open flow, so the board cannot place the work`,
          fix: `if this work already has a flow, put "Flow: <id>" in the message (or name the branch with its id); otherwise make one first with: ${ProjectLayout.VULCAN_COMMAND} flow add --title '<what this work is>' (it prints the id), then name the branch with that id (for example feature/<id>-<topic>) or put "Flow: <id>" in the message or the pull request body`,
        },
      ];
    } catch {
      return [];
    }
  }
}
