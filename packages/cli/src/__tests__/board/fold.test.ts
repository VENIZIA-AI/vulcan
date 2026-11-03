import { describe, expect, test } from 'bun:test';
import { BoardFold } from '../../board/fold.ts';
import { BoardGithub } from '../../board/github.ts';
import type { IBoardEvent } from '../../board/common/index.ts';
import { line, sampleLines } from './log-lines.helper.ts';

/** Who an ask waits on: a name that is nobody's default, to show the fold takes it as an input. */
const OWNER = 'Ana';

const fold = (opts: { lines?: ReturnType<typeof sampleLines>; extra?: IBoardEvent[] }) => {
  const log = BoardFold.fromLog({ events: opts.lines ?? [] });

  return {
    ...BoardFold.fold({ events: [...log.events, ...(opts.extra ?? [])], owner: OWNER }),
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
  test('commit, pr, msg, needs-owner and decision become the lines the page draws; sessions are plumbing lines', () => {
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

    expect(flow).toMatchObject({ state: 'you', holder: 'Ana', title: 'pagination cursor design' });
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

  test('a park decision followed by a commit is Running again; a park alone stays Parked', () => {
    const parked = [
      line({ minute: 0, kind: 'commit', actor: 'a-1', flow: 'F-8', summary: 'spike', ref: 'x' }),
      line({
        minute: 5,
        kind: 'decision',
        actor: 'veni-forge',
        flow: 'F-8',
        summary: 'later',
        status: 'park',
      }),
    ];

    expect(flowOf({ id: 'F-8', lines: parked }).state).toBe('parked');

    const resumed = [
      ...parked,
      line({
        minute: 9,
        kind: 'commit',
        actor: 'a-1',
        flow: 'F-8',
        summary: 'picked it up again',
        ref: 'y',
      }),
    ];

    expect(flowOf({ id: 'F-8', lines: resumed }).state).toBe('running');
    // A message after the park is not work: the flow stays parked.
    expect(
      flowOf({
        id: 'F-8',
        lines: [
          ...parked,
          line({
            minute: 9,
            kind: 'msg-sent',
            actor: 'a-1',
            flow: 'F-8',
            summary: 'note',
            ref: 'to:veni-forge',
          }),
        ],
      }).state,
    ).toBe('parked');
  });

  test('a merge is Done whatever follows it that is not work; a commit or a new pull request after it reopens', () => {
    const merged = [
      line({ minute: 0, kind: 'commit', actor: 'a-1', flow: 'F-8', summary: 'work', ref: 'x' }),
      line({
        minute: 5,
        kind: 'pr',
        actor: 'a-1',
        flow: 'F-8',
        summary: 'merged it',
        ref: 'merged:80',
      }),
    ];
    const chatter = [
      ...merged,
      line({
        minute: 9,
        kind: 'msg-sent',
        actor: 'a-1',
        flow: 'F-8',
        summary: 'thanks',
        ref: 'to:veni-forge',
      }),
      line({
        minute: 10,
        kind: 'needs-owner',
        actor: 'a-1',
        flow: 'F-9',
        summary: 'unrelated flow',
      }),
    ];

    expect(flowOf({ id: 'F-8', lines: merged }).state).toBe('done');
    expect(flowOf({ id: 'F-8', lines: chatter }).state).toBe('done');
    expect(
      flowOf({
        id: 'F-8',
        lines: [
          ...merged,
          line({
            minute: 12,
            kind: 'commit',
            actor: 'a-1',
            flow: 'F-8',
            summary: 'one more fix',
            ref: 'z',
          }),
        ],
      }).state,
    ).toBe('running');
    expect(
      flowOf({
        id: 'F-8',
        lines: [
          ...merged,
          line({
            minute: 12,
            kind: 'pr',
            actor: 'a-1',
            flow: 'F-8',
            summary: 'a second PR',
            ref: '#81',
          }),
        ],
      }).state,
    ).toBe('running');
  });

  test('an ask and its decision written in the same moment are ordered as they were logged', () => {
    const ask = line({
      minute: 3,
      kind: 'needs-owner',
      actor: 'a-1',
      flow: 'F-7',
      summary: 'Which way?',
    });
    const answer = {
      ...line({
        minute: 3,
        kind: 'decision',
        actor: 'veni-forge',
        flow: 'F-7',
        summary: 'cursor',
        status: 'approve',
      }),
      ts: ask.ts,
    };

    expect(flowOf({ id: 'F-7', lines: [ask, answer] }).state).toBe('running');
    // The other way round, the ask is the later line and is still waiting.
    expect(flowOf({ id: 'F-7', lines: [answer, ask] }).state).toBe('you');
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

describe('BoardFold.fold: the title of a flow', () => {
  const flowLine = (opts: { minute: number; title: string; why?: string; flow?: string }) =>
    line({
      minute: opts.minute,
      kind: 'flow',
      actor: 'pnt-vulcan-1',
      flow: opts.flow ?? 'F-1',
      summary: opts.title,
      ...(opts.why === undefined ? {} : { why: opts.why }),
    });

  test('a flow line names the flow and says why; the heading is no longer a message label', () => {
    const lines = [
      line({
        minute: 1,
        kind: 'msg-sent',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'status',
        ref: 'to:veni-forge',
      }),
      flowLine({
        minute: 2,
        title: 'Bảng theo dõi việc cho anh',
        why: 'để anh thấy việc nào chờ anh',
      }),
    ];
    const flow = flowOf({ id: 'F-1', lines });

    expect(flow).toMatchObject({
      title: 'Bảng theo dõi việc cho anh',
      named: true,
      why: 'để anh thấy việc nào chờ anh',
    });
  });

  test('the newest flow line wins, title and reason together; a newer one with no reason drops the old reason', () => {
    const lines = [
      flowLine({ minute: 1, title: 'First name', why: 'first reason' }),
      flowLine({ minute: 2, title: 'Second name', why: 'second reason' }),
    ];

    expect(flowOf({ id: 'F-1', lines })).toMatchObject({
      title: 'Second name',
      why: 'second reason',
    });
    expect(
      flowOf({ id: 'F-1', lines: [...lines, flowLine({ minute: 3, title: 'Third name' })] }),
    ).toEqual(expect.objectContaining({ title: 'Third name', named: true }));
    expect(
      flowOf({ id: 'F-1', lines: [...lines, flowLine({ minute: 3, title: 'Third name' })] }).why,
    ).toBeUndefined();
  });

  test("a flow with no flow line keeps today's heading and says it has no name", () => {
    const flow = flowOf({
      id: 'F-1',
      lines: [
        line({
          minute: 1,
          kind: 'commit',
          actor: 'pnt-vulcan-1',
          flow: 'F-1',
          summary: 'the lock',
          ref: 'abc1234',
        }),
      ],
    });

    expect(flow).toMatchObject({ title: 'the lock', named: false });
    expect(flow.why).toBeUndefined();
  });

  test('a flow made only of a flow line is a running flow held by whoever wrote it', () => {
    expect(
      flowOf({ id: 'F-1', lines: [flowLine({ minute: 1, title: 'Name', why: 'why' })] }),
    ).toMatchObject({
      state: 'running',
      holder: 'pnt-vulcan-1',
      title: 'Name',
    });
  });

  test('a flow line neither answers an ask nor reopens a merged flow', () => {
    const asked = [
      line({
        minute: 1,
        kind: 'needs-owner',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'Which way?',
      }),
      flowLine({ minute: 2, title: 'Name' }),
    ];
    const merged = [
      line({
        minute: 1,
        kind: 'pr',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'merged',
        ref: 'merged:5',
      }),
      flowLine({ minute: 2, title: 'Name' }),
    ];

    expect(flowOf({ id: 'F-1', lines: asked }).state).toBe('you');
    expect(flowOf({ id: 'F-1', lines: merged }).state).toBe('done');
  });
});

describe('BoardFold.fold: agent plumbing', () => {
  const work = line({
    minute: 1,
    kind: 'commit',
    actor: 'pnt-vulcan-1',
    flow: 'F-1',
    summary: 'the lock',
    ref: 'abc1234',
  });

  test('session lines, subagent stops and the harness waiting are marked plumbing and kept in the flow', () => {
    const lines = [
      work,
      line({
        minute: 2,
        kind: 'session-stop',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'turn ended',
      }),
      line({
        minute: 3,
        kind: 'subagent-stop',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'Explore a1',
      }),
      line({
        minute: 4,
        kind: 'needs-owner',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'idle_prompt',
      }),
      line({
        minute: 5,
        kind: 'needs-owner',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'permission_prompt',
      }),
    ];
    const flow = flowOf({ id: 'F-1', lines });

    expect(flow.events.filter((event) => event.plumbing === true)).toHaveLength(4);
    expect(flow.events.filter((event) => event.plumbing !== true)).toHaveLength(1);
    expect(flow.events.filter((event) => event.needsOwner === true)).toEqual([]);
  });

  test('the harness waiting never makes a flow wait on the owner, and a person asking still does', () => {
    const idle = line({
      minute: 2,
      kind: 'needs-owner',
      actor: 'pnt-vulcan-1',
      flow: 'F-1',
      summary: 'idle_prompt',
    });
    const asked = line({
      minute: 3,
      kind: 'needs-owner',
      actor: 'pnt-vulcan-1',
      flow: 'F-1',
      summary: 'Which way?',
    });

    expect(flowOf({ id: 'F-1', lines: [work, idle] }).state).toBe('running');
    expect(flowOf({ id: 'F-1', lines: [work, idle] }).askId).toBeUndefined();
    expect(flowOf({ id: 'F-1', lines: [work, idle, asked] })).toMatchObject({
      state: 'you',
      holder: OWNER,
    });
    expect(
      flowOf({ id: 'F-1', lines: [work, idle, asked] }).events.find(
        (event) => event.summary === 'Which way?',
      ),
    ).not.toHaveProperty('plumbing');
  });

  test('plumbing moves no stage, no last line, no title and does not undo a merge', () => {
    const merged = line({
      minute: 2,
      kind: 'pr',
      actor: 'pnt-vulcan-1',
      flow: 'F-1',
      summary: 'merged',
      ref: 'merged:5',
    });
    const plain = flowOf({ id: 'F-1', lines: [work, merged] });
    const noisy = flowOf({
      id: 'F-1',
      lines: [
        work,
        merged,
        line({
          minute: 3,
          kind: 'session-start',
          actor: 'pnt-vulcan-1',
          flow: 'F-1',
          summary: 'resume',
        }),
        line({
          minute: 4,
          kind: 'needs-owner',
          actor: 'pnt-vulcan-1',
          flow: 'F-1',
          summary: 'idle_prompt',
        }),
      ],
    });

    expect({ ...noisy, events: [] }).toEqual({ ...plain, events: [] });
    expect(noisy.state).toBe('done');
  });

  test('a flow with plumbing only is running, with its lines kept for the page to show on request', () => {
    const flow = flowOf({
      id: 'Unsorted',
      lines: [
        line({ minute: 1, kind: 'session-start', actor: 'pnt-ignis-1', summary: 'startup' }),
        line({ minute: 2, kind: 'session-stop', actor: 'pnt-ignis-1', summary: 'turn ended' }),
      ],
    });

    expect(flow).toMatchObject({
      state: 'running',
      named: false,
      title: 'Unsorted',
      holder: 'pnt-ignis-1',
    });
    expect(flow.events.every((event) => event.plumbing === true)).toBe(true);
    expect(flow.events).toHaveLength(2);
    expect(flow.events.find((event) => event.id === flow.lastId)).toBeDefined();
  });

  test('a harness prompt is not what an agent is doing', () => {
    const { agents } = fold({
      lines: [
        work,
        line({
          minute: 2,
          kind: 'needs-owner',
          actor: 'pnt-vulcan-1',
          flow: 'F-1',
          summary: 'idle_prompt',
        }),
      ],
    });

    expect(agents['pnt-vulcan-1'].current).toBe('the lock');
  });
});

describe('BoardFold.fold: a flow line only names the flow', () => {
  const flowLine = (minute: number, title: string) =>
    line({
      minute,
      kind: 'flow',
      actor: 'pnt-vulcan-1',
      flow: 'F-1',
      summary: title,
      why: 'because',
    });

  test('renaming a merged flow leaves its state, stage, strip, holder and last line as they were', () => {
    const lines = [
      line({
        minute: 1,
        kind: 'commit',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'the lock',
        ref: 'abc1234',
      }),
      line({
        minute: 2,
        kind: 'pr',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'merged',
        ref: 'merged:5',
      }),
    ];
    const before = flowOf({ id: 'F-1', lines });
    const after = flowOf({ id: 'F-1', lines: [...lines, flowLine(3, 'Renamed')] });

    expect(after).toMatchObject({
      title: 'Renamed',
      named: true,
      why: 'because',
      state: 'done',
      cur: 6,
    });
    expect({ ...after, title: '', named: false, why: undefined, events: [] }).toEqual({
      ...before,
      title: '',
      named: false,
      why: undefined,
      events: [],
    });
    expect(after.events.find((event) => event.id === after.lastId)?.kind).toBe('merge');
    expect(after.events.filter((event) => event.kind === 'flow')).toHaveLength(1);
  });

  test('a title written first or between lines changes no stage and no last line either', () => {
    const work = [
      line({
        minute: 2,
        kind: 'commit',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'the lock',
        ref: 'abc1234',
      }),
      line({
        minute: 4,
        kind: 'pr',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary: 'the pr',
        ref: '#9',
      }),
    ];
    const plain = flowOf({ id: 'F-1', lines: work });
    const named = flowOf({
      id: 'F-1',
      lines: [flowLine(1, 'Early'), flowLine(3, 'Middle'), ...work],
    });

    expect(named).toMatchObject({
      title: 'Middle',
      cur: plain.cur,
      stages: plain.stages,
      lastId: plain.lastId,
      state: plain.state,
    });
  });
});

describe('BoardFold.fold: a harness ask with a title', () => {
  const work = line({
    minute: 1,
    kind: 'commit',
    actor: 'pnt-vulcan-1',
    flow: 'F-1',
    summary: 'the lock',
    ref: 'abc1234',
  });

  test('the notification type from the hook makes it plumbing whatever its title says', () => {
    const asked = line({
      minute: 2,
      kind: 'needs-owner',
      actor: 'pnt-vulcan-1',
      flow: 'F-1',
      summary: 'Claude needs your permission to use Bash',
      notification: 'permission_prompt',
      source: 'claude-hook',
    });
    const flow = flowOf({ id: 'F-1', lines: [work, asked] });

    expect(flow.state).toBe('running');
    expect(flow.askId).toBeUndefined();
    expect(flow.events.find((event) => event.summary.startsWith('Claude needs'))).toMatchObject({
      plumbing: true,
    });
    expect(fold({ lines: [work, asked] }).agents['pnt-vulcan-1'].current).toBe('the lock');
  });

  test('a line written before the field existed is judged by its summary, in any case and with spaces', () => {
    for (const summary of ['idle_prompt', ' Permission_Prompt ', 'ELICITATION_DIALOG']) {
      const old = line({
        minute: 2,
        kind: 'needs-owner',
        actor: 'pnt-vulcan-1',
        flow: 'F-1',
        summary,
        source: 'claude-hook',
      });

      expect(flowOf({ id: 'F-1', lines: [work, old] }).state, summary).toBe('running');
    }
  });

  test('a question someone wrote still makes the flow wait, with or without a title-like text', () => {
    const asked = line({
      minute: 2,
      kind: 'needs-owner',
      actor: 'pnt-vulcan-1',
      flow: 'F-1',
      summary: 'Claude needs your decision on the schema',
    });

    expect(flowOf({ id: 'F-1', lines: [work, asked] })).toMatchObject({
      state: 'you',
      holder: OWNER,
    });
  });
});
