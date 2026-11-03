import { spawnSync } from 'node:child_process';
import { RecordValue } from '../common/record.ts';
import { EventFlow } from '../events/flow.ts';
import {
  BoardConstants,
  BoardKinds,
  BoardSources,
  BoardStages,
  BoardStatuses,
} from './common/index.ts';
import type { IBoardEvent } from './common/index.ts';

const PR_FIELDS =
  'number,title,author,headRefName,body,createdAt,updatedAt,mergedAt,closedAt,state,url,reviews,statusCheckRollup';
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);
const BODY_FLOW = /\bFlow:\s*(F-\d+)\b/;

const text = (opts: { value: unknown }): string =>
  typeof opts.value === 'string' ? opts.value : '';

/** Pull requests, their checks and their reviews, read through `gh`: an extra for projects on GitHub. */
export class BoardGithub {
  /**
   * The lines of the pull requests of `repos` (the current repository when none is named) that changed since `since`.
   * Nothing is posted. When `gh` is missing, not logged in, or the folder is not a GitHub repository, the answer is
   * no lines and a note that says why, never an error: the board is fully useful from the event log alone.
   */
  static read(opts: { repos: string[]; cwd: string; since: number }): {
    events: IBoardEvent[];
    note: string;
  } {
    if (Bun.which('gh') === null) {
      return { events: [], note: 'github: skipped, gh is not installed' };
    }

    const repos = opts.repos.length > 0 ? opts.repos : BoardGithub.currentRepo({ cwd: opts.cwd });

    if (repos === undefined || repos.length === 0) {
      return {
        events: [],
        note: 'github: skipped, this folder is not a GitHub repository gh can read',
      };
    }

    const events: IBoardEvent[] = [];
    const notes: string[] = [];

    for (const repo of repos) {
      const listed = spawnSync(
        'gh',
        [
          'pr',
          'list',
          '--repo',
          repo,
          '--state',
          'all',
          '--limit',
          String(BoardConstants.GH_LIMIT),
          '--json',
          PR_FIELDS,
        ],
        { cwd: opts.cwd, encoding: 'utf8', timeout: BoardConstants.GH_TIMEOUT_MS },
      );

      if (listed.status !== 0) {
        notes.push(
          `${repo} skipped (${(listed.stderr ?? '').trim().split('\n')[0] || 'gh failed'})`,
        );
        continue;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(listed.stdout);
      } catch {
        notes.push(`${repo} skipped (gh did not answer with JSON)`);
        continue;
      }

      const prs = Array.isArray(parsed) ? parsed : [];
      const fresh = prs.filter(
        (pr) => RecordValue.isRecord(pr) && Date.parse(text({ value: pr.updatedAt })) >= opts.since,
      );

      for (const pr of fresh) {
        events.push(...BoardGithub.eventsOf({ pr, repo }));
      }

      notes.push(`${repo} ${fresh.length} pull request(s)`);
    }

    return { events, note: `github: ${notes.join(', ')}` };
  }

  /** `Flow: F-n` in the body of a pull request, else an `F-n` segment of its branch, else none. */
  static flowOf(opts: { body: string; branch: string }): string | undefined {
    return BODY_FLOW.exec(opts.body)?.[1] ?? EventFlow.fromBranchName({ branch: opts.branch });
  }

  /** The lines one pull request stands for: opened, each check, each review, merged or closed. */
  static eventsOf(opts: { pr: unknown; repo: string }): IBoardEvent[] {
    const { pr, repo } = opts;

    if (!RecordValue.isRecord(pr) || typeof pr.number !== 'number') {
      return [];
    }

    const number = pr.number;
    const author = RecordValue.isRecord(pr.author) ? text({ value: pr.author.login }) : '';
    const flowId =
      BoardGithub.flowOf({
        body: text({ value: pr.body }),
        branch: text({ value: pr.headRefName }),
      }) ?? BoardConstants.UNSORTED;
    const base = {
      flowId,
      source: BoardSources.GITHUB,
      ref: { repo, pr: number },
      link: text({ value: pr.url }),
    };
    const id = (part: string): string => `gh:${repo}#${number}:${part}`;
    const events: IBoardEvent[] = [
      {
        ...base,
        id: id('pr'),
        ts: text({ value: pr.createdAt }),
        kind: BoardKinds.PR,
        stage: BoardStages.PR_AND_CI,
        actor: author,
        status: BoardStatuses.OPEN,
        summary: `#${number} ${text({ value: pr.title })}`,
      },
    ];

    for (const [index, check] of (Array.isArray(pr.statusCheckRollup)
      ? pr.statusCheckRollup
      : []
    ).entries()) {
      const line = BoardGithub.checkOf({ check, index, base, id });

      if (line !== undefined) {
        events.push(line);
      }
    }

    for (const [index, review] of (Array.isArray(pr.reviews) ? pr.reviews : []).entries()) {
      if (RecordValue.isRecord(review) && text({ value: review.submittedAt }) !== '') {
        const state = text({ value: review.state });

        events.push({
          ...base,
          id: id(`review-${index}`),
          ts: text({ value: review.submittedAt }),
          kind: BoardKinds.REVIEW,
          stage: BoardStages.REVIEW,
          actor: RecordValue.isRecord(review.author)
            ? text({ value: review.author.login })
            : 'reviewer',
          status: state === 'CHANGES_REQUESTED' ? BoardStatuses.FAIL : BoardStatuses.PASS,
          summary: state.toLowerCase().replace('_', ' '),
        });
      }
    }

    const merged = text({ value: pr.mergedAt });
    const closed = text({ value: pr.closedAt });

    if (merged !== '') {
      events.push({
        ...base,
        id: id('merge'),
        ts: merged,
        kind: BoardKinds.MERGE,
        stage: BoardStages.MERGE,
        actor: author,
        status: BoardStatuses.DONE,
        summary: 'merged',
      });
    } else if (closed !== '' && text({ value: pr.state }) === 'CLOSED') {
      events.push({
        ...base,
        id: id('closed'),
        ts: closed,
        kind: BoardKinds.PR,
        stage: BoardStages.PR_AND_CI,
        actor: author,
        status: BoardStatuses.CLOSED,
        summary: 'closed without merge',
      });
    }

    return events.filter((event) => event.ts !== '');
  }

  private static checkOf(opts: {
    check: unknown;
    index: number;
    base: Pick<IBoardEvent, 'flowId' | 'source' | 'ref' | 'link'>;
    id: (part: string) => string;
  }): IBoardEvent | undefined {
    const { check } = opts;

    if (!RecordValue.isRecord(check)) {
      return undefined;
    }

    const name = text({ value: check.name }) || text({ value: check.context }) || 'check';
    const outcome = (
      text({ value: check.conclusion }) || text({ value: check.state })
    ).toUpperCase();
    const at = text({ value: check.completedAt }) || text({ value: check.startedAt });

    if (at === '' || (!PASSED.has(outcome) && !FAILED.has(outcome))) {
      return undefined;
    }

    const url = text({ value: check.detailsUrl }) || text({ value: check.targetUrl });

    return {
      ...opts.base,
      ...(url.startsWith('https://') ? { link: url } : {}),
      id: opts.id(`ci-${opts.index}`),
      ts: at,
      kind: BoardKinds.CI,
      stage: BoardStages.PR_AND_CI,
      actor: BoardConstants.CI_ACTOR,
      check: name,
      status: FAILED.has(outcome) ? BoardStatuses.FAIL : BoardStatuses.PASS,
      summary: name,
    };
  }

  private static currentRepo(opts: { cwd: string }): string[] | undefined {
    const result = spawnSync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      { cwd: opts.cwd, encoding: 'utf8', timeout: BoardConstants.GH_TIMEOUT_MS },
    );
    const name = result.status === 0 ? result.stdout.trim() : '';

    return name === '' ? undefined : [name];
  }
}
