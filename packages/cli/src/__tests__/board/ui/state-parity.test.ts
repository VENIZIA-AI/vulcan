import { afterAll, describe, expect, test } from 'bun:test';
import type { IBoardData, IBoardEvent } from '../../../board/common/index.ts';
import { BoardPage } from '../../../board/page.ts';
import { BoardLanguages } from '../../../board/ui/common/constants.ts';
import type { TBoardLanguage } from '../../../board/ui/common/types.ts';
import { DICTIONARY } from '../../../board/ui/i18n/dictionary.ts';
import { BoardI18n } from '../../../board/ui/i18n/translate.ts';
import { BoardLatest } from '../../../board/ui/state/latest.ts';
import { BoardTime } from '../../../board/ui/state/time.ts';
import { BoardView } from '../../../board/ui/state/view.ts';
import { BrowserPage } from '../../visualize/browser.helper.ts';
import { sampleData } from '../sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

const base = (): IBoardData => sampleData({ base: Date.now() - 100 * 60_000 });

/** Lines of every kind the Latest text and the rows tell apart, in the first flow of the data. */
const withLines = (opts: { data: IBoardData; lines: Partial<IBoardEvent>[] }): IBoardData => {
  const [flow] = opts.data.flows;
  const at = flow.events.at(-1)?.ts ?? new Date().toISOString();

  flow.events.push(
    ...opts.lines.map((line, index) => ({
      id: `extra-${index}`,
      flowId: flow.id,
      ts: at,
      kind: 'note',
      stage: 3,
      actor: 'pnt-vulcan-1',
      summary: `line ${index}`,
      source: 'claude-hook',
      ...line,
    })),
  );

  return opts.data;
};

const FIXTURES: Record<string, IBoardData> = {
  'the sample day': base(),
  'no data at all': { ...base(), flows: [], agents: {}, decisions: {} },
  'a roster and lanes': {
    ...base(),
    roster: ['veni-forge', 'pnt-vulcan-1'],
    lanes: { 'pnt-ignis-1': 'pnt-vulcan-1', 'pnt-ardor-1': 'veni-forge' },
  },
  'a roster with a helper that holds a flow': {
    ...base(),
    roster: ['veni-forge'],
    lanes: { 'pnt-vulcan-1': 'veni-forge' },
  },
  'a blocked flow held by an agent': (() => {
    const data = base();

    data.flows[0].state = 'blocked';
    data.flows[0].holder = 'pnt-vulcan-1';

    return data;
  })(),
  'lines of every kind: incoming messages, an ask, an estimated time, the owner and GitHub':
    withLines({
      data: base(),
      lines: [
        { kind: 'msg', incoming: true, from: 'veni-forge' },
        { kind: 'msg', incoming: true },
        { kind: 'msg', to: 'veni-forge' },
        { kind: 'note', needsOwner: true },
        { kind: 'decision', choice: 'approve', actor: 'Ana' },
        { kind: 'commit', source: 'git (ước lượng)' },
        { kind: 'ci', actor: 'CI', status: 'fail', attempt: 1, source: 'github' },
        { kind: 'review', actor: 'reviewer', status: 'ok', attempt: 1, source: 'github' },
        { kind: 'note', actor: 'CI', source: 'cli' },
      ],
    }),
};

/** What the page of today works out, in one language, by the functions the new modules replace. */
const OLD_PAGE = `(() => {
  const take = () => {
    loadEvents();
    FL = fold();

    return { fl: FL, events, docs: laneDocs(DATA.agents), rows: agentRows().map(({ host, compact, ...row }) => row) };
  };
  const out = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, lastSeen, by: {} };

  for (const language of ['en', 'vi']) {
    lang = language;
    showPlumbing = false;

    const hidden = take();

    showPlumbing = true;

    const all = take();

    showPlumbing = false;
    out.by[language] = {
      hidden,
      all,
      latest: all.events.map((event) => latestText(event)),
      ago: all.events.map((event) => ago(event.ts)),
    };
  }

  lang = 'en';

  const lines = out.by.en.all.events;

  out.clock = lines.map((event) => hhmm(event.ts));
  out.sameDay = lines.map((event) => sameDay(event.ts));
  out.approx = lines.map((event) => isApprox(event));

  return JSON.stringify(out);
})()`;

interface IOldState {
  fl: unknown[];
  events: unknown[];
  docs: unknown;
  rows: unknown[];
}

interface IOldLanguage {
  hidden: IOldState;
  all: IOldState;
  latest: string[];
  ago: string[];
}

interface IOld {
  /** The time zone of the browser: the page says times in it, so the comparison is made in it. */
  zone: string;
  lastSeen: string;
  by: Record<TBoardLanguage, IOldLanguage>;
  clock: string[];
  sameDay: boolean[];
  approx: boolean[];
}

const same = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const LANGUAGES: TBoardLanguage[] = [BoardLanguages.EN, BoardLanguages.VI];

describe.skipIf(!hasBrowser)('the state modules do what the page of today does', () => {
  for (const [name, data] of Object.entries(FIXTURES)) {
    test(`${name}: flows, lines, agent states, rows and texts are the same, in both languages`, async () => {
      const raw = await BrowserPage.measure<string>({
        html: BoardPage.render({ data }),
        width: 1440,
        dark: false,
        expression: OLD_PAGE,
      });
      const old: IOld = JSON.parse(raw);
      const lines = BoardView.eventsOf({ data, showAll: true });
      const zone = process.env.TZ;

      process.env.TZ = old.zone;

      try {
        expect(lines.map((event) => BoardTime.clock({ iso: event.ts }))).toEqual(old.clock);
        expect(
          lines.map((event) => BoardTime.isSameDay({ iso: event.ts, now: Date.now() })),
        ).toEqual(old.sameDay);
      } finally {
        if (zone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = zone;
        }
      }

      expect(lines.map((event) => BoardTime.isApproximate({ source: event.source }))).toEqual(
        old.approx,
      );

      for (const language of LANGUAGES) {
        const translate = (key: string): string => BoardI18n.translate({ language, key });
        const was = old.by[language];

        for (const showAll of [false, true]) {
          const before = showAll ? was.all : was.hidden;
          const events = BoardView.eventsOf({ data, showAll });
          const flows = BoardView.flowsOf({ data, showAll, lastSeen: old.lastSeen });
          const docs = BoardView.docsOf({ data });
          const rows = BoardView.rowsOf({ data, flows, events, docs, showAll, translate });
          const at = `${language}, showAll=${showAll}`;

          expect(same(events), `events, ${at}`).toEqual(before.events);
          expect(
            same(
              flows.map((view) => ({
                id: view.flow.id,
                noWork: view.noWork,
                f: {
                  title: view.flow.title,
                  repo: view.flow.repo,
                  why: view.flow.why,
                  context: view.flow.context,
                  next: view.flow.next,
                  named: view.named,
                },
                evs: view.evs,
                last: view.last,
                state: view.flow.state,
                holder: view.holder,
                stages: view.flow.stages,
                cur: view.flow.cur,
                att: view.att,
                lastAsk: view.lastAsk,
                dec: view.dec,
                unread: view.newCount > 0,
                newCount: view.newCount,
                approxLast: view.approxLast,
              })),
            ),
            `flows, ${at}`,
          ).toEqual(before.fl);
          expect(same(docs), `docs, ${at}`).toEqual(before.docs);
          expect(same(rows), `rows, ${at}`).toEqual(before.rows);
        }

        expect(lines.map((event) => BoardLatest.textOf({ event, translate }))).toEqual(was.latest);
        expect(
          lines.map((event) => BoardTime.ago({ iso: event.ts, now: Date.now(), translate })),
        ).toEqual(was.ago);
      }
    });
  }

  test('every word of both languages translates as it does in the page, and an unknown key is itself', async () => {
    const keys = [...Object.keys(DICTIONARY.en), ...Object.keys(DICTIONARY.vi), 'no such key'];
    const raw = await BrowserPage.measure<string>({
      html: BoardPage.render({ data: base() }),
      width: 1440,
      dark: false,
      expression: `(() => {
        const keys = ${JSON.stringify(keys)};
        const out = {};
        for (const language of ['en', 'vi']) {
          lang = language;
          out[language] = keys.map((key) => t(key));
        }
        lang = 'en';
        return JSON.stringify(out);
      })()`,
    });
    const old: Record<string, string[]> = JSON.parse(raw);

    for (const language of LANGUAGES) {
      expect(keys.map((key) => BoardI18n.translate({ language, key }))).toEqual(old[language]);
    }
  });
});

describe('the dictionary', () => {
  test('every id of the Vietnamese overrides has an English text, and none maps to itself', () => {
    const ids = Object.keys(DICTIONARY.vi);

    expect(ids.length).toBeGreaterThan(50);
    expect(ids.filter((id) => !(id in DICTIONARY.en))).toEqual([]);
    expect(Object.entries(DICTIONARY.vi).filter(([key, text]) => key === text)).toEqual([]);
  });
});
