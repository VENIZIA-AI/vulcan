import { afterAll, describe, expect, test } from 'bun:test';
import { BoardFold } from '../../board/fold.ts';
import { BoardSettings } from '../../board/settings.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { EventLog } from '../../events/index.ts';
import type { IEvent, IEventItem, TEventKind } from '../../events/common/index.ts';
import { BoardPage } from '../../board/page.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const BASE = Date.parse('2026-11-04T08:00:00Z');
const make = (opts: {
  minute: number;
  kind: TEventKind;
  actor?: string;
  summary: string;
  flow?: string;
  source?: string;
  model?: string;
  steps?: IEventItem[];
  checks?: IEventItem[];
  apps?: string[];
  due?: string;
  ref?: string;
  next?: string;
}): IEvent =>
  EventLog.build({
    kind: opts.kind,
    summary: opts.summary,
    actor: opts.actor ?? 'agent-a-1',
    source: opts.source ?? 'cli',
    ...(opts.flow === undefined ? {} : { flowId: opts.flow }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
    ...(opts.steps === undefined ? {} : { steps: opts.steps }),
    ...(opts.checks === undefined ? {} : { checks: opts.checks }),
    ...(opts.apps === undefined ? {} : { apps: opts.apps }),
    ...(opts.due === undefined ? {} : { due: opts.due }),
    ...(opts.ref === undefined ? {} : { ref: opts.ref }),
    ...(opts.next === undefined ? {} : { next: opts.next }),
    now: BASE + opts.minute * 60_000,
  });
const fold = (events: IEvent[]) => {
  const log = BoardFold.fromLog({ events });

  return { ...BoardFold.fold({ events: log.events, owner: 'Ana' }), agents: log.agents };
};

describe('the lists of a flow line reach the flow', () => {
  const flow = 'VULZ-ACME-1';

  test('the steps, the checks, the apps, the due day and the tracker id come from the newest flow line, whole', () => {
    const { flows } = fold([
      make({
        minute: 0,
        kind: 'flow',
        summary: 'Sign in',
        flow,
        steps: [{ text: 'old step', done: false }],
        apps: ['old'],
        due: '2026-11-01',
        ref: 'OLD-1',
      }),
      make({
        minute: 5,
        kind: 'flow',
        summary: 'Sign in',
        flow,
        steps: [
          { text: 'one', done: true },
          { text: 'two', done: false },
        ],
        checks: [{ text: 'works', done: false }],
        apps: ['web', 'admin'],
        due: '2026-11-08',
        ref: 'PLANE-3054',
      }),
      make({ minute: 6, kind: 'commit', summary: 'code', flow }),
    ]);
    const [found] = flows;

    expect(found.steps).toEqual([
      { text: 'one', done: true },
      { text: 'two', done: false },
    ]);
    expect(found.checks).toEqual([{ text: 'works', done: false }]);
    expect(found.apps).toEqual(['web', 'admin']);
    expect(found.due).toBe('2026-11-08');
    expect(found.tracker).toBe('PLANE-3054');
  });

  test('a newer flow line that leaves the lists out drops the old ones: nothing stale outlives its line', () => {
    const { flows } = fold([
      make({
        minute: 0,
        kind: 'flow',
        summary: 'Sign in',
        flow,
        steps: [{ text: 'one', done: true }],
        due: '2026-11-08',
      }),
      make({
        minute: 5,
        kind: 'flow',
        summary: 'Sign in',
        flow,
        next: 'agent-a opens the pull request',
      }),
      make({ minute: 6, kind: 'commit', summary: 'code', flow }),
    ]);

    expect(flows[0].steps).toBeUndefined();
    expect(flows[0].due).toBeUndefined();
    expect(flows[0].next).toBe('agent-a opens the pull request');
  });

  test('a deploy line is a release line of its flow, with its time and its words', () => {
    const { flows } = fold([
      make({ minute: 0, kind: 'commit', summary: 'code', flow }),
      make({ minute: 9, kind: 'deploy', summary: 'block 10', flow }),
    ]);
    const release = flows[0].events.find((event) => event.kind === 'release');

    expect(release?.summary).toBe('block 10');
    expect(flows[0].events).toHaveLength(2);
  });
});

describe('what an agent card knows of a session', () => {
  test('the model of the session start and the harness of the hook; neither is made up', () => {
    const { agents } = fold([
      make({
        minute: 0,
        kind: 'session-start',
        actor: 'a',
        summary: 'startup m',
        source: 'claude-hook',
        model: 'claude-sonnet-5-5',
      }),
      make({
        minute: 1,
        kind: 'session-start',
        actor: 'b',
        summary: 'startup',
        source: 'claude-hook',
      }),
      make({ minute: 2, kind: 'commit', actor: 'c', summary: 'x', flow: 'F-1' }),
      make({ minute: 3, kind: 'commit', actor: 'a', summary: 'y', flow: 'F-1' }),
    ]);

    expect(agents.a).toMatchObject({ model: 'claude-sonnet-5-5', harness: 'Claude Code' });
    expect(agents.b.model).toBeUndefined();
    expect(agents.b.harness).toBe('Claude Code');
    expect(agents.c.model).toBeUndefined();
    expect(agents.c.harness).toBeUndefined();
  });
});

describe('board.agents: the role of an agent', () => {
  const parse = (agents: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ board: { agents } });
  const resolve = (agents: unknown) =>
    BoardSettings.resolve({
      manifest: { board: { agents } },
      gitUser: undefined,
      readLogo: () => undefined,
    });

  test('a role is free text with a shape or a lane, or alone; blank and over 60 characters are refused', () => {
    expect(parse({ lead: { role: 'Backend' }, a: { shape: 'bun', role: 'Reviews' } }).success).toBe(
      true,
    );
    expect(parse({ lead: { role: '' } }).success).toBe(false);
    expect(parse({ lead: { role: '   ' } }).success).toBe(false);
    expect(parse({ lead: { role: 'x'.repeat(61) } }).success).toBe(false);
  });

  test('the settings carry the roles, and an agent with a face only or none has no role', () => {
    const settings = resolve({ lead: { role: 'Backend' }, a: 'flame', helper: { lane: 'lead' } });

    expect(settings.roles).toEqual({ lead: 'Backend' });
    expect(settings.roster).toEqual(['lead', 'a']);
  });
});

describe.skipIf(!hasBrowser)("today's detail shows the lists", () => {
  test('steps and checks as checklists with their count, the apps as chips, the due day and the tracker id', async () => {
    const data = sampleData({ base: Date.now() - 100 * 60_000 });
    const [target] = data.flows;

    Object.assign(target, {
      steps: [
        { text: 'first step', done: true },
        { text: 'second step', done: false },
        { text: 'third step', done: true },
      ],
      checks: [{ text: 'a check', done: false }],
      apps: ['web-sale', 'admin'],
      due: '2026-11-08',
      tracker: 'PLANE-3054',
    });

    const raw = await BrowserPage.measure<string>({
      html: BoardPage.render({ data }),
      width: 1440,
      dark: false,
      expression: `(async () => {
        const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
        localStorage.clear();
        document.querySelectorAll('.gh[aria-expanded="false"]').forEach((button) => button.click());
        await wait();
        document.querySelector('.row[data-id="${target.id}"]').click();
        await wait();
        const lists = [...document.querySelectorAll('#dBody .ckl')].map((box) => ({
          label: box.querySelector('.lb').textContent,
          items: [...box.querySelectorAll('li')].map((li) => [li.textContent, li.classList.contains('on')]),
        }));
        return JSON.stringify({
          lists,
          apps: [...document.querySelectorAll('#dBody .apps .chip')].map((chip) => chip.textContent),
          meta: document.querySelector('#dBody .meta').textContent,
        });
      })()`,
    });
    const seen: {
      lists: { label: string; items: [string, boolean][] }[];
      apps: string[];
      meta: string;
    } = JSON.parse(raw);

    expect(seen.lists[0].label).toBe('Steps · 2/3');
    expect(seen.lists[0].items).toEqual([
      ['first step', true],
      ['second step', false],
      ['third step', true],
    ]);
    expect(seen.lists[1]).toEqual({
      label: 'Acceptance checks · 0/1',
      items: [['a check', false]],
    });
    expect(seen.apps).toEqual(['web-sale', 'admin']);
    expect(seen.meta).toContain('2026-11-08');
    expect(seen.meta).toContain('PLANE-3054');
  });
});
