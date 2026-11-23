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
 * V-P-13, held by the git guard: in a project that logs events, `git commit`, `gh pr create` and `glab mr create` are refused
 * when no flow can be found for the work, and the reason says the command that makes one. A flow is found when the branch
 * names it (`feature/VULZ-ACME-12-...`), when the command itself carries a flow id (`Flow: VULZ-ACME-12` in a message or
 * body), or when this session last opened or updated one that is not over. It fails open: a log, a manifest or a clock
 * that cannot be read is no refusal, and with `events.log` off the rule does not exist.
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

      const activity = GitActivity.classify({ command: opts.command });

      if (activity !== GitActivities.COMMIT && activity !== GitActivities.PR_OPEN) {
        return [];
      }

      if (
        EventConstants.FLOW_PATTERN.test(opts.command) ||
        (opts.cwd !== undefined && EventFlow.fromBranch({ cwd: opts.cwd }) !== undefined)
      ) {
        return [];
      }

      const actor = EventActor.resolve({ sessionId: opts.sessionId, env: opts.env });
      const key = EventSettings.keyOf({ root: opts.root });
      const known = EventLog.read({
        dir: EventSettings.dirOf({ root: opts.root, settings }),
        since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
      }).events;

      if (
        FlowSteps.lastOpenedBy({
          events: known,
          actor,
          isOver: (flowId) => opts.isOver({ events: known, flowId, key }),
        }) !== undefined
      ) {
        return [];
      }

      return [
        {
          decision: GuardDecisions.DENY,
          rule: 'V-P-13',
          message: `${activity === GitActivities.COMMIT ? 'a commit' : 'a pull request'} with no flow: the branch does not name one and this session has no open flow, so the board cannot place the work`,
          fix: `make the flow first with: ${ProjectLayout.VULCAN_COMMAND} event add --kind flow --title "<what this work is>" (it prints the id), then name the branch with that id (for example feature/<id>-<topic>) or put "Flow: <id>" in the message or the pull request body`,
        },
      ];
    } catch {
      return [];
    }
  }
}
