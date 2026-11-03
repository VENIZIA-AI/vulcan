import { describe, expect, test } from 'bun:test';
import { BoardFold } from '../../board/fold.ts';
import { BoardGithub } from '../../board/github.ts';
import type { IBoardEvent } from '../../board/common/index.ts';
import { line, sampleLines } from './log-lines.helper.ts';

const fold = (opts: { lines?: ReturnType<typeof sampleLines>; extra?: IBoardEvent[] }) => {
  const log = BoardFold.fromLog({ events: opts.lines ?? [] });

  return {
    ...BoardFold.fold({ events: [...log.events, ...(opts.extra ?? [])] }),
    agents: log.agents,
  };
};
const flowOf = (opts: {
  id: string;
  lines?: ReturnType<typeof sampleLines>;
  extra?: IBoardEvent[];
}) => {
  const found = fold(opts).flows.find((flow) => flow.id === opts.id);

  if (found === undefined) {
    throw new Error(`no flow ${opts.id}`);
  }

  return found;
};

/** Pull request 70, on branch feature/F-9-board: opened, CI red then green, one round of changes requested, then approved. */
const PR_JSON = {
  number: 70,
  title: 'vulcan board',
  author: { login: 'pnt-vulcan-1' },
  headRefName: 'feature/F-9-board',
  body: 'The board.\n\nFlow: F-9',
  createdAt: '2026-11-03T09:00:00Z',
  updatedAt: '2026-11-03T11:00:00Z',
  mergedAt: null,
  closedAt: null,
  state: 'OPEN',
  url: 'https://github.com/VENIZIA-AI/vulcan/pull/70',
  reviews: [
    {
      author: { login: 'reviewer-1' },
      state: 'CHANGES_REQUESTED',
      submittedAt: '2026-11-03T09:30:00Z',
    },
    { author: { login: 'reviewer-1' }, state: 'APPROVED', submittedAt: '2026-11-03T10:30:00Z' },
  ],
  statusCheckRollup: [
    {
      name: 'Build, test and lint',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      completedAt: '2026-11-03T09:10:00Z',
      detailsUrl: 'https://github.com/VENIZIA-AI/vulcan/actions/runs/1',
    },
    {
      name: 'Source gates',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      completedAt: '2026-11-03T09:12:00Z',
      detailsUrl: 'https://github.com/VENIZIA-AI/vulcan/actions/runs/1',
    },
    {
      name: 'Still running',
      status: 'IN_PROGRESS',
      conclusion: '',
      startedAt: '2026-11-03T09:13:00Z',
    },
  ],
};

describe('BoardFold.fromLog', () => {
  test('commit, pr, msg, needs-owner and decision become the lines the page draws; sessions are not lines', () => {
    const { events } = BoardFold.fromLog({ events: sampleLines() });
    const kinds = events.map((event) => `${event.flowId}:${event.kind}`);

    expect(kinds).toContain('F-1:commit');
    expect(kinds).toContain('F-1:pr');
    expect(kinds).toContain('F-1:msg');
    expect(kinds).toContain('F-2:note');
    expect(kinds).toContain('F-3:decision');
    expect(kinds).toContain('F-4:merge');
    expect(kinds.some((entry) => entry.includes('session'))).toBe(false);
    expect(events.find((event) => event.kind === 'pr' && event.flowId === 'F-1')).toMatchObject({
      stage: 4,
      ref: { pr: 662 },
    });
    expect(events.find((event) => event.kind === 'merge')).toMatchObject({
      stage: 6,
      status: 'done',
      ref: { pr: 666 },
    });
    expect(events.find((event) => event.needsOwner)).toMatchObject({
      flowId: 'F-2',
      needsOwner: true,
    });
  });

  test('the recipient of a message is the to: part of its ref', () => {
    const { events } = BoardFold.fromLog({ events: sampleLines() });

    expect(events.find((event) => event.kind === 'msg')).toMatchObject({
      to: 'veni-forge',
      actor: 'pnt-vulcan-1',
    });
  });

  test('a line with no flow is in Unsorted', () => {
    const { events } = BoardFold.fromLog({ events: sampleLines() });

    expect(events.find((event) => event.summary === 'fix a typo in the docs')?.flowId).toBe(
      'Unsorted',
    );
  });

  test('a session line only moves an agent: start is working, stop is idle, the last work line is what it does', () => {
    const { agents } = BoardFold.fromLog({ events: sampleLines() });

    expect(agents['pnt-vulcan-1']).toMatchObject({
      state: 'idle',
      current: 'fix a typo in the docs',
    });
    expect(agents['pnt-ignis-1']).toMatchObject({ state: 'working', name: 'pnt-ignis-1' });
    expect(agents['veni-forge'].state).toBe('working');
  });
});

describe('BoardFold.fold: state', () => {
  test('an ask nobody answered is Needs you, held by the owner', () => {
    const flow = flowOf({ id: 'F-2', lines: sampleLines() });

    expect(flow).toMatchObject({ state: 'you', holder: 'Phát', title: 'pagination cursor design' });
    expect(flow.askId).toBeDefined();
  });

  test('a later decision answers it; the flow runs again', () => {
    expect(flowOf({ id: 'F-3', lines: sampleLines() })).toMatchObject({
      state: 'running',
      holder: 'pnt-ardor-1',
      cur: 3,
    });
  });

  test('a decision alone answers it, with no work after it', () => {
    const lines = [
      line({
        minute: 0,
        kind: 'needs-owner',
        actor: 'pnt-ignis-1',
        flow: 'F-7',
        summary: 'Which way?',
      }),
      line({
        minute: 5,
        kind: 'decision',
        actor: 'veni-forge',
        flow: 'F-7',
        summary: 'cursor',
        status: 'approve',
      }),
    ];

    expect(flowOf({ id: 'F-7', lines }).state).toBe('running');
  });

  test('a later commit answers it too, when no decision was logged', () => {
    const lines = [
      line({
        minute: 0,
        kind: 'needs-owner',
        actor: 'pnt-ignis-1',
        flow: 'F-7',
        summary: 'Which way?',
      }),
      line({
        minute: 5,
        kind: 'commit',
        actor: 'pnt-ignis-1',
        flow: 'F-7',
        summary: 'went with cursor',
        ref: 'a1',
      }),
    ];

    expect(flowOf({ id: 'F-7', lines }).state).toBe('running');
  });

  test('a message does not answer an ask', () => {
    const lines = [
      line({
        minute: 0,
        kind: 'needs-owner',
        actor: 'pnt-ignis-1',
        flow: 'F-7',
        summary: 'Which way?',
      }),
      line({
        minute: 5,
        kind: 'msg-sent',
        actor: 'pnt-ignis-1',
        flow: 'F-7',
        summary: 'reminder',
        ref: 'to:veni-forge',
      }),
    ];

    expect(flowOf({ id: 'F-7', lines }).state).toBe('you');
  });

  test('a parked or rejected decision is Parked', () => {
    expect(flowOf({ id: 'F-5', lines: sampleLines() }).state).toBe('parked');

    const rejected = [
      line({ minute: 0, kind: 'commit', actor: 'a-1', flow: 'F-8', summary: 'spike', ref: 'x' }),
      line({
        minute: 5,
        kind: 'decision',
        actor: 'veni-forge',
        flow: 'F-8',
        summary: 'no',
        status: 'reject',
      }),
    ];

    expect(flowOf({ id: 'F-8', lines: rejected }).state).toBe('parked');
  });

  test('a merged pull request is Done', () => {
    expect(flowOf({ id: 'F-4', lines: sampleLines() })).toMatchObject({ state: 'done', cur: 6 });
  });

  test('a failed CI run with nothing committed since is Blocked; a commit after it is Running again', () => {
    const failed = BoardGithub.eventsOf({
      pr: { ...PR_JSON, reviews: [], statusCheckRollup: [PR_JSON.statusCheckRollup[0]] },
      repo: 'VENIZIA-AI/vulcan',
    });

    expect(flowOf({ id: 'F-9', extra: failed })).toMatchObject({
      state: 'blocked',
      holder: 'pnt-vulcan-1',
    });

    const fixed = fold({
      lines: [
        line({
          minute: 600,
          kind: 'commit',
          actor: 'pnt-vulcan-1',
          flow: 'F-9',
          summary: 'fix the lint',
          ref: 'f1',
        }),
      ],
      extra: failed,
    }).flows.find((flow) => flow.id === 'F-9');

    expect(fixed?.state).toBe('running');
  });

  test('changes requested with nothing committed since is Blocked', () => {
    const events = BoardGithub.eventsOf({
      pr: { ...PR_JSON, statusCheckRollup: [], reviews: [PR_JSON.reviews[0]] },
      repo: 'VENIZIA-AI/vulcan',
    });

    expect(flowOf({ id: 'F-9', extra: events }).state).toBe('blocked');
  });

  test('an old failed run that a later approval and merge followed is not Blocked', () => {
    const events = BoardGithub.eventsOf({
      pr: { ...PR_JSON, state: 'MERGED', mergedAt: '2026-11-03T11:00:00Z' },
      repo: 'VENIZIA-AI/vulcan',
    });

    expect(flowOf({ id: 'F-9', extra: events })).toMatchObject({ state: 'done', cur: 6 });
  });
});

describe('BoardFold.fold: stage, holder, attempts', () => {
  test('the stage is the one of the last line; stages are the ones reached', () => {
    const flow = flowOf({ id: 'F-1', lines: sampleLines() });

    expect(flow.cur).toBe(4);
    expect(flow.stages).toEqual([3, 4]);
  });

  test('a message takes the stage the flow was at', () => {
    const flow = flowOf({ id: 'F-1', lines: sampleLines() });

    expect(flow.events.find((event) => event.kind === 'msg')?.stage).toBe(4);
  });

  test('the holder is the actor of the last work line; a named recipient later than the work takes it; an address does not', () => {
    expect(flowOf({ id: 'F-1', lines: sampleLines() }).holder).toBe('veni-forge');

    const quiet = [
      line({
        minute: 0,
        kind: 'commit',
        actor: 'pnt-vulcan-1',
        flow: 'F-6',
        summary: 'work',
        ref: 'a',
      }),
      line({
        minute: 3,
        kind: 'msg-sent',
        actor: 'pnt-vulcan-1',
        flow: 'F-6',
        summary: 'handing over',
        ref: 'to:uds:3326301.sock',
      }),
    ];

    expect(flowOf({ id: 'F-6', lines: quiet }).holder).toBe('pnt-vulcan-1');
  });

  test('CI runs of one check count as attempts 1, 2, 3; review rounds are counted', () => {
    const rerun = (conclusion: string, minute: number) => ({
      name: 'Build, test and lint',
      status: 'COMPLETED',
      conclusion,
      completedAt: `2026-11-03T09:${String(minute).padStart(2, '0')}:00Z`,
    });
    const events = BoardGithub.eventsOf({
      pr: {
        ...PR_JSON,
        statusCheckRollup: [rerun('FAILURE', 10), rerun('FAILURE', 20), rerun('SUCCESS', 30)],
      },
      repo: 'VENIZIA-AI/vulcan',
    });
    const flow = flowOf({ id: 'F-9', extra: events });

    expect(
      flow.events.filter((event) => event.kind === 'ci').map((event) => event.attempt),
    ).toEqual([1, 2, 3]);
    expect(flow).toMatchObject({ ciRuns: 3, reviewRounds: 2 });
  });
});

describe('BoardFold.fold: the whole sample', () => {
  test('five flows and Unsorted, each with a state', () => {
    const { flows, decisions } = fold({ lines: sampleLines() });

    expect(Object.fromEntries(flows.map((flow) => [flow.id, flow.state]))).toEqual({
      'F-1': 'running',
      'F-2': 'you',
      'F-3': 'running',
      'F-4': 'done',
      'F-5': 'parked',
      Unsorted: 'running',
    });
    expect(flows.find((flow) => flow.id === 'Unsorted')?.title).toBe('Unsorted');
    expect(decisions['F-3']).toMatchObject({ choice: 'approve' });
    expect(decisions['F-5']).toMatchObject({ choice: 'later' });
  });

  test('lines of one flow are in time order whatever order they were read in', () => {
    const flow = flowOf({ id: 'F-3', lines: sampleLines().reverse() });

    expect(flow.events.map((event) => event.kind)).toEqual(['note', 'decision', 'commit']);
  });
});

describe('BoardGithub.eventsOf', () => {
  const events = BoardGithub.eventsOf({ pr: PR_JSON, repo: 'VENIZIA-AI/vulcan' });

  test('the flow comes from Flow: F-n in the body, else from the branch, else Unsorted', () => {
    expect(new Set(events.map((event) => event.flowId))).toEqual(new Set(['F-9']));
    expect(BoardGithub.flowOf({ body: '', branch: 'fix/F-12-thing' })).toBe('F-12');
    expect(BoardGithub.flowOf({ body: 'Flow: F-3', branch: 'fix/F-12-thing' })).toBe('F-3');
    expect(
      BoardGithub.eventsOf({ pr: { ...PR_JSON, body: '', headRefName: 'main' }, repo: 'a/b' })[0]
        .flowId,
    ).toBe('Unsorted');
  });

  test('opened, each finished check, each review; a check still running is left out', () => {
    expect(events.map((event) => `${event.kind}:${event.status ?? ''}`)).toEqual([
      'pr:open',
      'ci:fail',
      'ci:pass',
      'review:fail',
      'review:pass',
    ]);
    expect(events[0]).toMatchObject({
      summary: '#70 vulcan board',
      actor: 'pnt-vulcan-1',
      link: 'https://github.com/VENIZIA-AI/vulcan/pull/70',
      ref: { repo: 'VENIZIA-AI/vulcan', pr: 70 },
    });
    expect(events[1]).toMatchObject({
      actor: 'CI',
      check: 'Build, test and lint',
      link: 'https://github.com/VENIZIA-AI/vulcan/actions/runs/1',
    });
  });

  test('merged adds a merge line; closed without merge closes the pull request', () => {
    const merged = BoardGithub.eventsOf({
      pr: { ...PR_JSON, state: 'MERGED', mergedAt: '2026-11-03T12:00:00Z' },
      repo: 'a/b',
    });
    const closed = BoardGithub.eventsOf({
      pr: { ...PR_JSON, state: 'CLOSED', closedAt: '2026-11-03T12:00:00Z' },
      repo: 'a/b',
    });

    expect(merged.at(-1)).toMatchObject({ kind: 'merge', status: 'done', stage: 6 });
    expect(closed.at(-1)).toMatchObject({ kind: 'pr', status: 'closed' });
  });

  test('a CI line after its pull request was closed does not decide the state', () => {
    const closed = BoardGithub.eventsOf({
      pr: {
        ...PR_JSON,
        state: 'CLOSED',
        closedAt: '2026-11-03T09:05:00Z',
        reviews: [],
        statusCheckRollup: [PR_JSON.statusCheckRollup[0]],
      },
      repo: 'a/b',
    });

    expect(flowOf({ id: 'F-9', extra: closed }).state).not.toBe('blocked');
  });

  test('anything that is not a pull request is ignored', () => {
    expect(BoardGithub.eventsOf({ pr: null, repo: 'a/b' })).toEqual([]);
    expect(BoardGithub.eventsOf({ pr: { title: 'x' }, repo: 'a/b' })).toEqual([]);
  });
});
