import { describe, expect, test } from 'bun:test';
import type { IBoardAgent, IBoardData } from '../../../board/common/index.ts';
import { BoardLanguages } from '../../../board/ui/common/constants.ts';
import type { IBoardViewEvent } from '../../../board/ui/common/types.ts';
import { DICTIONARY } from '../../../board/ui/i18n/dictionary.ts';
import { BoardI18n } from '../../../board/ui/i18n/translate.ts';
import { BoardLatest } from '../../../board/ui/state/latest.ts';
import { BoardTime } from '../../../board/ui/state/time.ts';
import { BoardView } from '../../../board/ui/state/view.ts';

const en = (key: string): string => BoardI18n.translate({ language: BoardLanguages.EN, key });
const line = (opts: Partial<IBoardViewEvent>): IBoardViewEvent => ({
  id: 'a',
  flowId: 'F-1',
  ts: '2026-11-03T10:00:00.000Z',
  kind: 'note',
  stage: 0,
  actor: 'ana',
  summary: 'did it',
  source: 'cli',
  ...opts,
});
const agent = (opts: Partial<IBoardAgent>): IBoardAgent => ({
  name: 'x',
  state: 'idle',
  current: '',
  since: '2026-11-03T10:00:00.000Z',
  checkedAt: '2026-11-03T10:00:00.000Z',
  ...opts,
});
const data = (opts: Partial<IBoardData>): IBoardData => ({
  title: 't',
  owner: 'Ana',
  key: 'k',
  shapes: {},
  generatedAt: '2026-11-03T10:00:00.000Z',
  since: '2026-10-27T10:00:00.000Z',
  flows: [],
  decisions: {},
  agents: {},
  sources: [],
  ...opts,
});

describe('BoardI18n', () => {
  test('English translates a Vietnamese source text, Vietnamese keeps it, and a key with no entry is itself', () => {
    expect(en('Anh duyệt')).toBe('Approval');
    expect(BoardI18n.translate({ language: BoardLanguages.VI, key: 'Anh duyệt' })).toBe(
      'Anh duyệt',
    );
    expect(BoardI18n.translate({ language: BoardLanguages.VI, key: 'g.you' })).toBe('Cần anh');
    expect(en('no such key')).toBe('no such key');
  });
});

describe('BoardTime', () => {
  const now = Date.parse('2026-11-03T12:00:00.000Z');
  const ago = (iso: string): string => BoardTime.ago({ iso, now, translate: en });

  test('ago says just now, minutes, hours with minutes, and days', () => {
    expect(ago('2026-11-03T11:59:40.000Z')).toBe('just now');
    expect(ago('2026-11-03T11:15:00.000Z')).toBe('45 min');
    expect(ago('2026-11-03T09:30:00.000Z')).toBe('2 h 30 min');
    expect(ago('2026-11-01T12:00:00.000Z')).toBe('2 d');
  });

  test('a time that is not one is --:--, and an estimated source is approximate', () => {
    expect(BoardTime.clock({ iso: 'soon' })).toBe('--:--');
    expect(BoardTime.isApproximate({ source: 'git (ước lượng)' })).toBe(true);
    expect(BoardTime.isApproximate({ source: 'cli' })).toBe(false);
    expect(BoardTime.isApproximate({})).toBe(false);
  });
});

describe('BoardLatest', () => {
  const said = (opts: Partial<IBoardViewEvent>): string =>
    BoardLatest.textOf({ event: line(opts), translate: en });

  test('a message says who it came from or went to, as the helper when there is one', () => {
    expect(said({ kind: 'msg', incoming: true, from: 'bo' })).toBe(
      `ana ${en('lt.gotFrom')} bo: did it`,
    );
    expect(said({ kind: 'msg', incoming: true })).toBe(`ana ${en('lt.got')}: did it`);
    expect(said({ kind: 'msg', to: 'bo', asTo: 'helper', as: 'h2' })).toBe(
      `h2 ${en('lt.msgTo')} helper: did it`,
    );
  });

  test('a decision says what was decided, an ask says it waits, and no summary adds no colon', () => {
    expect(said({ kind: 'decision', choice: 'approve' })).toBe(`ana ${en('lt.approve')}: did it`);
    expect(said({ needsOwner: true })).toBe(`ana ${en('lt.ask')}: did it`);
    expect(said({ summary: '' })).toBe(`ana ${en('lt.note')}`);
  });
});

describe('BoardView', () => {
  const none = { showAll: false, translate: en };

  test('no data gives no flows, no lines and no rows', () => {
    const empty = data({});
    const flows = BoardView.flowsOf({ data: empty, showAll: false, lastSeen: '' });
    const events = BoardView.eventsOf({ data: empty, showAll: false });

    expect(flows).toEqual([]);
    expect(events).toEqual([]);
    expect(BoardView.rowsOf({ data: empty, flows, events, docs: {}, ...none })).toEqual([]);
  });

  test('a helper is merged into its lane: working beats idle and the newest note speaks', () => {
    const docs = BoardView.docsOf({
      data: data({
        lanes: { helper: 'lead' },
        agents: {
          lead: agent({ current: 'old', checkedAt: '2026-11-03T09:00:00.000Z' }),
          helper: agent({
            state: 'working',
            current: 'new',
            checkedAt: '2026-11-03T10:00:00.000Z',
          }),
        },
      }),
    });

    expect(Object.keys(docs)).toEqual(['lead']);
    expect(docs.lead).toMatchObject({ state: 'working', current: 'new' });
  });

  test('the rows leave out the owner, CI and reviewers, and an idle agent says it is idle', () => {
    const agents = {
      Ana: agent({}),
      CI: agent({}),
      reviewer: agent({}),
      bo: agent({ current: 'tidy' }),
    };
    const board = data({ agents });
    const rows = BoardView.rowsOf({ data: board, flows: [], events: [], docs: agents, ...none });

    expect(rows.map((row) => [row.n, row.st, row.text])).toEqual([
      ['bo', 'idle', `${en('rảnh · ')}tidy`],
    ]);
  });

  test('a roster limits the rows unless every event is shown', () => {
    const agents = { bo: agent({}), cy: agent({}) };
    const board = data({ agents, roster: ['bo'] });
    const rowsOf = (showAll: boolean) =>
      BoardView.rowsOf({
        data: board,
        flows: [],
        events: [],
        docs: agents,
        showAll,
        translate: en,
      }).map((row) => row.n);

    expect(rowsOf(false)).toEqual(['bo']);
    expect(rowsOf(true)).toEqual(['bo', 'cy']);
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
