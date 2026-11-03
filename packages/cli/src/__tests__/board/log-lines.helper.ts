import { EventLog } from '../../events/log.ts';
import type { IEvent, TEventKind, TEventStatus } from '../../events/common/index.ts';

export const T0 = Date.parse('2026-11-03T08:00:00Z');

/** A line of the event log as an agent or a hook writes it; `minute` is the minutes after `base` (default 08:00 UTC on 2026-11-03). */
export const line = (opts: {
  base?: number;
  minute: number;
  kind: TEventKind;
  actor: string;
  summary: string;
  flow?: string;
  ref?: string;
  status?: TEventStatus;
}): IEvent =>
  EventLog.build({
    kind: opts.kind,
    summary: opts.summary,
    actor: opts.actor,
    source: 'cli',
    ...(opts.flow === undefined ? {} : { flowId: opts.flow }),
    ...(opts.ref === undefined ? {} : { ref: opts.ref }),
    ...(opts.status === undefined ? {} : { status: opts.status }),
    now: (opts.base ?? T0) + opts.minute * 60_000,
  });

const SAMPLE: Parameters<typeof line>[0][] = [
  { minute: 0, kind: 'session-start', actor: 'pnt-vulcan-1', summary: 'startup claude-sonnet-5-5' },
  { minute: 1, kind: 'session-start', actor: 'pnt-ignis-1', summary: 'resume claude-sonnet-5-5' },
  { minute: 2, kind: 'session-start', actor: 'veni-forge', summary: 'startup claude-opus-5-5' },
  // F-1: running, at the pull request.
  { minute: 5, kind: 'commit', actor: 'pnt-vulcan-1', flow: 'F-1', summary: 'event log: the kinds and the log file', ref: 'abc1234' },
  { minute: 9, kind: 'pr', actor: 'pnt-vulcan-1', flow: 'F-1', summary: 'event log PR', ref: '#662' },
  { minute: 12, kind: 'msg-sent', actor: 'pnt-vulcan-1', flow: 'F-1', summary: 'PR open, ready for review', ref: 'to:veni-forge' },
  // F-2: waiting on the owner.
  { minute: 20, kind: 'commit', actor: 'pnt-ignis-1', flow: 'F-2', summary: 'pagination cursor design', ref: 'def5678' },
  { minute: 25, kind: 'needs-owner', actor: 'pnt-ignis-1', flow: 'F-2', summary: 'Choose cursor or offset pagination' },
  // F-3: asked, then approved, then coding goes on.
  { minute: 30, kind: 'needs-owner', actor: 'pnt-ardor-1', flow: 'F-3', summary: 'Approve the retry design' },
  { minute: 34, kind: 'decision', actor: 'veni-forge', flow: 'F-3', summary: 'Phat approved the retry design', status: 'approve' },
  { minute: 40, kind: 'commit', actor: 'pnt-ardor-1', flow: 'F-3', summary: 'retry with backoff', ref: '99aa001' },
  // F-4: merged.
  { minute: 45, kind: 'commit', actor: 'pnt-vulcan-1', flow: 'F-4', summary: 'ci affected', ref: 'c0ffee1' },
  { minute: 50, kind: 'pr', actor: 'pnt-vulcan-1', flow: 'F-4', summary: 'ci affected PR', ref: '#666' },
  { minute: 70, kind: 'pr', actor: 'veni-forge', flow: 'F-4', summary: 'merged ci affected', ref: 'merged:666' },
  // F-5: parked by the owner.
  { minute: 75, kind: 'commit', actor: 'pnt-ignis-1', flow: 'F-5', summary: 'spike: edge cache', ref: 'beef002' },
  { minute: 80, kind: 'decision', actor: 'veni-forge', flow: 'F-5', summary: 'Phat parked the edge cache spike', status: 'park' },
  // No flow.
  { minute: 85, kind: 'commit', actor: 'pnt-vulcan-1', summary: 'fix a typo in the docs', ref: 'dead003' },
  { minute: 90, kind: 'session-stop', actor: 'pnt-vulcan-1', summary: 'turn ended' },
];

/** The day the board shows, as a list of realistic lines of five flows and four agents. */
export const sampleLines = (opts: { base?: number } = {}): IEvent[] =>
  SAMPLE.map((entry) => line({ ...entry, base: opts.base }));
