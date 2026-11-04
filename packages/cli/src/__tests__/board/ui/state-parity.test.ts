import { afterAll, describe, expect, test } from 'bun:test';
import { BoardPage } from '../../../board/page.ts';
import type { IBoardData } from '../../../board/common/index.ts';
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
/** A flow that also carries the lines GitHub gives: a CI run and a review, whose actors are no agents. */
const withGithub = (): IBoardData => {
  const data = base();
  const [flow] = data.flows;
  const at = flow.events.at(-1)?.ts ?? new Date().toISOString();

  flow.events.push(
    {
      id: 'gh-ci',
      flowId: flow.id,
      ts: at,
      kind: 'ci',
      stage: 4,
      actor: 'CI',
      status: 'fail',
      attempt: 1,
      check: 'build',
      summary: 'build failed',
      source: 'github',
    },
    {
      id: 'gh-rv',
      flowId: flow.id,
      ts: at,
      kind: 'review',
      stage: 5,
      actor: 'reviewer',
      status: 'ok',
      attempt: 1,
      summary: 'approved',
      source: 'github',
    },
  );

  // Names that are no agent, found in the agent states and in a line that did not come from GitHub.
  data.agents.reviewer = {
    name: 'reviewer',
    state: 'working',
    current: 'reading',
    since: at,
    checkedAt: at,
  };
  flow.events.push({
    id: 'cli-ci',
    flowId: flow.id,
    ts: at,
    kind: 'note',
    stage: 4,
    actor: 'CI',
    summary: 'a note',
    source: 'cli',
  });

  return data;
};

const FIXTURES: Record<string, IBoardData> = {
  'a flow with GitHub lines': withGithub(),
  'the sample day': base(),
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
};

/** What the page of today works out, by the functions the new modules replace. */
const OLD_PAGE = `(() => {
  const take = () => {
    loadEvents();
    FL = fold();

    return { fl: FL, events, docs: laneDocs(DATA.agents), rows: agentRows().map(({ host, ...row }) => row) };
  };
  const hidden = take();

  showPlumbing = true;

  const all = take();

  showPlumbing = false;

  return JSON.stringify({
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lastSeen,
    hidden,
    all,
    latest: all.events.map((event) => latestText(event)),
    clock: all.events.map((event) => hhmm(event.ts)),
    ago: all.events.map((event) => ago(event.ts)),
    sameDay: all.events.map((event) => sameDay(event.ts)),
    approx: all.events.map((event) => isApprox(event)),
  });
})()`;

interface IOldState {
  fl: unknown[];
  events: unknown[];
  docs: unknown;
  rows: unknown[];
}

interface IOld {
  /** The time zone of the browser: the page says times in it, so the comparison is made in it. */
  zone: string;
  lastSeen: string;
  hidden: IOldState;
  all: IOldState;
  latest: string[];
  clock: string[];
  ago: string[];
  sameDay: boolean[];
  approx: boolean[];
}

const same = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe.skipIf(!hasBrowser)('the state modules do what the page of today does', () => {
  const translate = (key: string): string =>
    BoardI18n.translate({ language: BoardLanguages.EN, key });

  for (const [name, data] of Object.entries(FIXTURES)) {
    test(`${name}: flows, lines, agent states and rows are the same, with and without the plumbing`, async () => {
      const raw = await BrowserPage.measure<string>({
        html: BoardPage.render({ data }),
        width: 1440,
        dark: false,
        expression: OLD_PAGE,
      });
      const old: IOld = JSON.parse(raw);

      for (const showAll of [false, true]) {
        const was = showAll ? old.all : old.hidden;
        const events = BoardView.eventsOf({ data, showAll });
        const flows = BoardView.flowsOf({ data, showAll, lastSeen: old.lastSeen });
        const docs = BoardView.docsOf({ data });
        const rows = BoardView.rowsOf({ data, flows, events, docs, showAll, translate });

        expect(same(events), `events, showAll=${showAll}`).toEqual(was.events);
        expect(
          same(flows.map(({ title, ...flow }) => ({ ...flow, f: title }))),
          `flows, showAll=${showAll}`,
        ).toEqual(was.fl);
        expect(same(docs), `docs, showAll=${showAll}`).toEqual(was.docs);
        expect(same(rows), `rows, showAll=${showAll}`).toEqual(was.rows);
      }

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

      expect(lines.map((event) => BoardLatest.textOf({ event, translate }))).toEqual(old.latest);
      expect(lines.map((event) => BoardTime.isApproximate({ source: event.source }))).toEqual(
        old.approx,
      );
      expect(
        lines.map((event) => BoardTime.ago({ iso: event.ts, now: Date.now(), translate })),
      ).toEqual(old.ago);
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

    const languages: TBoardLanguage[] = [BoardLanguages.EN, BoardLanguages.VI];

    for (const language of languages) {
      expect(keys.map((key) => BoardI18n.translate({ language, key }))).toEqual(old[language]);
    }
  });
});

describe('the dictionary', () => {
  test('every id of the Vietnamese overrides has an English text', () => {
    const ids = Object.keys(DICTIONARY.vi);

    expect(ids.length).toBeGreaterThan(50);
    expect(ids.filter((id) => !(id in DICTIONARY.en))).toEqual([]);
  });
});
