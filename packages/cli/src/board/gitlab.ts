import { spawnSync } from 'node:child_process';
import { RecordValue } from '../common/record.ts';
import { EventConstants } from '../events/common/index.ts';
import {
  BoardConstants,
  BoardKinds,
  BoardSources,
  BoardStages,
  BoardStatuses,
} from './common/index.ts';
import type { IBoardEvent } from './common/index.ts';
import { BoardGithub } from './github.ts';

const text = RecordValue.textOf;
const FINISHED = new Set(['success', 'failed', 'canceled', 'skipped']);
const SCP_REMOTE = /^(?:[^@/\s]+@)?([\w.-]+):(?!\/\/)(.+)$/;

type TBase = Pick<IBoardEvent, 'flowId' | 'source' | 'ref' | 'link'>;

interface IKnownRequest {
  iid: number;
  branch: string;
  base: TBase;
}

/** Merge requests, their approvals, pipelines and commits, read through `glab api`: an extra for projects on GitLab. */
export class BoardGitlab {
  /**
   * The lines of the GitLab projects `repos` (the project of `origin` when none is named and its host is `host`)
   * that changed since `since`. Only GET requests are made, by `glab`, which owns the sign-in. When `glab` is
   * missing, not logged in, or the folder is not a GitLab project it can read, the answer is no lines and a note
   * that says why, never an error.
   */
  static read(opts: { repos: string[]; cwd: string; since: number; host: string }): {
    events: IBoardEvent[];
    note: string;
  } {
    if (Bun.which('glab', { PATH: process.env.PATH ?? '' }) === null) {
      return { events: [], note: 'gitlab: skipped, glab is not installed' };
    }

    const projects =
      opts.repos.length > 0
        ? opts.repos
        : BoardGitlab.currentProject({ cwd: opts.cwd, host: opts.host });

    if (projects === undefined) {
      return {
        events: [],
        note: 'gitlab: skipped, this folder is not a GitLab project glab can read',
      };
    }

    const events: IBoardEvent[] = [];
    const notes: string[] = [];

    for (const project of projects) {
      const read = BoardGitlab.readProject({ ...opts, project });

      events.push(...read.events);
      notes.push(read.note);
    }

    return { events, note: `gitlab: ${notes.join(', ')}` };
  }

  /** The host name and the project path of a remote URL (`ssh://`, `https://` or scp-style), or none; credentials are never kept. */
  static parseRemote(opts: { url: string }): { host: string; path: string } | undefined {
    const scp = SCP_REMOTE.exec(opts.url);
    let host = scp?.[1] ?? '';
    let path = scp?.[2] ?? '';

    if (scp === null) {
      try {
        const parsed = new URL(opts.url);

        host = parsed.hostname;
        path = parsed.pathname;
      } catch {
        return undefined;
      }
    }

    const cleaned = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');

    return host !== '' && BoardConstants.PROJECT_PATH.test(cleaned)
      ? { host: host.toLowerCase(), path: cleaned }
      : undefined;
  }

  private static currentProject(opts: { cwd: string; host: string }): string[] | undefined {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: BoardConstants.GH_TIMEOUT_MS,
    });
    const remote =
      result.status === 0 ? BoardGitlab.parseRemote({ url: result.stdout.trim() }) : undefined;

    return remote !== undefined && remote.host === opts.host.replace(/:\d+$/, '').toLowerCase()
      ? [remote.path]
      : undefined;
  }

  private static get(opts: { host: string; cwd: string; endpoint: string }): {
    data?: unknown;
    problem?: string;
  } {
    const result = spawnSync('glab', ['api', '--hostname', opts.host, opts.endpoint], {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: BoardConstants.GH_TIMEOUT_MS,
    });

    if (result.status !== 0) {
      return { problem: (result.stderr ?? '').trim().split('\n')[0] || 'glab failed' };
    }

    try {
      return { data: JSON.parse(result.stdout) };
    } catch {
      return { problem: 'glab did not answer with JSON' };
    }
  }

  private static listOf(opts: {
    host: string;
    cwd: string;
    endpoint: string;
    label: string;
    problems: string[];
    since: number;
    stamp: string;
  }): Record<string, unknown>[] {
    const { data, problem } = BoardGitlab.get(opts);

    if (problem !== undefined) {
      opts.problems.push(`${opts.label} skipped (${problem})`);
    }

    return (Array.isArray(data) ? data : []).filter(
      (item): item is Record<string, unknown> =>
        RecordValue.isRecord(item) && Date.parse(text({ value: item[opts.stamp] })) >= opts.since,
    );
  }

  private static readProject(opts: { project: string; cwd: string; since: number; host: string }): {
    events: IBoardEvent[];
    note: string;
  } {
    const { project, since } = opts;
    const base = `projects/${encodeURIComponent(project)}`;
    const found = BoardGitlab.get({ ...opts, endpoint: base });

    if (!RecordValue.isRecord(found.data)) {
      return { events: [], note: `${project} skipped (${found.problem ?? 'not a project'})` };
    }

    const problems: string[] = [];
    const moment = encodeURIComponent(new Date(since).toISOString());
    const page = `per_page=${BoardConstants.GH_LIMIT}`;
    const list = (endpoint: string, label: string, stamp: string) =>
      BoardGitlab.listOf({ ...opts, endpoint: `${base}/${endpoint}`, label, problems, stamp });
    const known = list(
      `merge_requests?state=all&order_by=updated_at&updated_after=${moment}&${page}`,
      'merge requests',
      'updated_at',
    )
      .flatMap((mr) =>
        typeof mr.iid === 'number'
          ? [
              {
                mr,
                iid: mr.iid,
                branch: text({ value: mr.source_branch }),
                base: BoardGitlab.baseOf({ mr, iid: mr.iid, project }),
              },
            ]
          : [],
      )
      .slice(0, BoardConstants.GH_LIMIT);
    const events: IBoardEvent[] = [];

    for (const request of known) {
      const approvals = BoardGitlab.get({
        ...opts,
        endpoint: `${base}/merge_requests/${request.iid}/approvals`,
      });

      if (approvals.problem !== undefined) {
        problems.push(`approvals of !${request.iid} skipped (${approvals.problem})`);
      }

      events.push(...BoardGitlab.requestEvents({ ...request, project, approvals: approvals.data }));
    }

    const pipelines = list(
      `pipelines?order_by=updated_at&updated_after=${moment}&${page}`,
      'pipelines',
      'updated_at',
    );

    for (const [index, pipeline] of pipelines.entries()) {
      if (typeof pipeline.id !== 'number') {
        continue;
      }

      const jobs =
        index < BoardConstants.GITLAB_JOB_PIPELINES &&
        FINISHED.has(text({ value: pipeline.status }))
          ? BoardGitlab.get({
              ...opts,
              endpoint: `${base}/pipelines/${pipeline.id}/jobs?per_page=${BoardConstants.GH_LIMIT}`,
            })
          : {};

      if (jobs.problem !== undefined) {
        problems.push(`jobs of pipeline ${pipeline.id} skipped (${jobs.problem})`);
      }

      events.push(
        ...BoardGitlab.pipelineEvents({ pipeline, jobs: jobs.data, project, requests: known }),
      );
    }

    const branch = text({ value: found.data.default_branch });
    const commits =
      branch === ''
        ? []
        : list(
            `repository/commits?ref_name=${encodeURIComponent(branch)}&since=${moment}&${page}`,
            'commits',
            'committed_date',
          );

    events.push(...commits.flatMap((commit) => BoardGitlab.commitEvents({ commit, project })));

    const counted = `${project} ${known.length} merge request(s), ${pipelines.length} pipeline(s), ${commits.length} commit(s) since the date (the newest ${BoardConstants.GH_LIMIT} of each are asked for)`;

    return {
      events: events.filter((event) => event.ts !== ''),
      note: problems.length === 0 ? counted : `${counted} (${problems.join('; ')})`,
    };
  }

  /** `Flow: <id>` in the description of a merge request, else a flow id as a segment of its branch, else none. */
  private static baseOf(opts: {
    mr: Record<string, unknown>;
    iid: number;
    project: string;
  }): TBase {
    const { mr } = opts;

    return {
      flowId:
        BoardGithub.flowOf({
          body: text({ value: mr.description }),
          branch: text({ value: mr.source_branch }),
        }) ?? BoardConstants.UNSORTED,
      source: BoardSources.GITLAB,
      ref: { repo: opts.project, pr: opts.iid },
      link: text({ value: mr.web_url }),
    };
  }

  /** The lines one merge request stands for: opened, each approval, merged or closed. */
  private static requestEvents(opts: {
    mr: Record<string, unknown>;
    iid: number;
    base: TBase;
    project: string;
    approvals: unknown;
  }): IBoardEvent[] {
    const { mr, base, iid } = opts;
    const author = RecordValue.isRecord(mr.author) ? text({ value: mr.author.username }) : '';
    const id = (part: string): string => `gl:${opts.project}!${iid}:${part}`;
    const events: IBoardEvent[] = [
      {
        ...base,
        id: id('mr'),
        ts: text({ value: mr.created_at }),
        kind: BoardKinds.PR,
        stage: BoardStages.PR_AND_CI,
        actor: author,
        status: BoardStatuses.OPEN,
        summary: `!${iid} ${text({ value: mr.title })}`,
      },
    ];
    const merged = text({ value: mr.merged_at });
    const closed = text({ value: mr.closed_at });
    const approvedAt = merged || closed || text({ value: mr.updated_at });
    const approvers = RecordValue.isRecord(opts.approvals) ? opts.approvals.approved_by : undefined;

    for (const [index, approval] of (Array.isArray(approvers) ? approvers : []).entries()) {
      events.push({
        ...base,
        id: id(`review-${index}`),
        ts: approvedAt,
        kind: BoardKinds.REVIEW,
        stage: BoardStages.REVIEW,
        actor:
          RecordValue.isRecord(approval) && RecordValue.isRecord(approval.user)
            ? text({ value: approval.user.username }) || 'reviewer'
            : 'reviewer',
        status: BoardStatuses.PASS,
        summary: 'approved',
      });
    }

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
    } else if (closed !== '' && text({ value: mr.state }) === 'closed') {
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

    return events;
  }

  /** One line per finished job of a pipeline, or one for the pipeline when no job can be read. */
  private static pipelineEvents(opts: {
    pipeline: Record<string, unknown>;
    jobs: unknown;
    project: string;
    requests: IKnownRequest[];
  }): IBoardEvent[] {
    const { pipeline, project } = opts;
    const ref = text({ value: pipeline.ref });
    const owner = opts.requests.find(
      (request) => request.branch === ref || ref === `refs/merge-requests/${request.iid}/head`,
    );
    const base: TBase = owner?.base ?? {
      flowId: BoardConstants.UNSORTED,
      source: BoardSources.GITLAB,
      ref: { repo: project },
    };
    const line = (part: {
      id: string;
      ts: string;
      check: string;
      status: string;
      link: string;
    }): IBoardEvent | undefined => {
      if (part.ts === '' || (part.status !== 'success' && part.status !== 'failed')) {
        return undefined;
      }

      return {
        ...base,
        ...(part.link === '' ? {} : { link: part.link }),
        id: `gl:${project}:${part.id}`,
        ts: part.ts,
        kind: BoardKinds.CI,
        stage: BoardStages.PR_AND_CI,
        actor: BoardConstants.CI_ACTOR,
        check: part.check,
        status: part.status === 'success' ? BoardStatuses.PASS : BoardStatuses.FAIL,
        summary: part.check,
      };
    };
    const fromJobs = (Array.isArray(opts.jobs) ? opts.jobs : []).flatMap((job: unknown) =>
      RecordValue.isRecord(job) && typeof job.id === 'number'
        ? [
            line({
              id: `ci-${job.id}`,
              ts: text({ value: job.finished_at }) || text({ value: job.started_at }),
              check: text({ value: job.name }) || 'job',
              status: text({ value: job.status }),
              link: text({ value: job.web_url }),
            }),
          ]
        : [],
    );
    const lines = fromJobs.filter((event): event is IBoardEvent => event !== undefined);

    if (lines.length > 0) {
      return lines;
    }

    const whole = line({
      id: `ci-pipeline-${String(pipeline.id)}`,
      ts: text({ value: pipeline.updated_at }),
      check: 'pipeline',
      status: text({ value: pipeline.status }),
      link: text({ value: pipeline.web_url }),
    });

    return whole === undefined ? [] : [whole];
  }

  private static commitEvents(opts: {
    commit: Record<string, unknown>;
    project: string;
  }): IBoardEvent[] {
    const { commit } = opts;
    const sha = text({ value: commit.id });

    if (sha === '') {
      return [];
    }

    return [
      {
        id: `gl:${opts.project}:commit-${sha.slice(0, 8)}`,
        flowId:
          EventConstants.FLOW_LINE.exec(text({ value: commit.message }))?.[1] ??
          BoardConstants.UNSORTED,
        ts: text({ value: commit.committed_date }),
        kind: BoardKinds.COMMIT,
        stage: BoardStages.CODE,
        actor: text({ value: commit.author_name }),
        source: BoardSources.GITLAB,
        ref: { repo: opts.project },
        link: text({ value: commit.web_url }),
        summary: text({ value: commit.title }),
      },
    ];
  }
}
