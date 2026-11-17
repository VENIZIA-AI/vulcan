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

  test('a message says who it came from or went to', () => {
    expect(said({ kind: 'msg', incoming: true, from: 'bo' })).toBe(
      `ana ${en('lt.gotFrom')} bo: did it`,
    );
    expect(said({ kind: 'msg', incoming: true })).toBe(`ana ${en('lt.got')}: did it`);
    expect(said({ kind: 'msg', to: 'bo' })).toBe(`ana ${en('lt.msgTo')} bo: did it`);
  });

  test('a decision says what was decided, an ask says it waits, and no summary adds no colon', () => {
    expect(said({ kind: 'decision', choice: 'approve' })).toBe(`ana ${en('lt.approve')}: did it`);
    expect(said({ needsOwner: true })).toBe(`ana ${en('lt.ask')}: did it`);
    expect(said({ summary: '' })).toBe(`ana ${en('lt.note')}`);
  });
});

describe('BoardView', () => {
  const now = Date.parse('2026-11-03T10:05:00.000Z');
  const none = { translate: en, now };

  test('no data gives no flows, no lines and no rows', () => {
    const empty = data({});
    const flows = BoardView.flowsOf({ data: empty, showAll: false, lastSeen: '' });
    const events = BoardView.eventsOf({ data: empty, showAll: false });

    expect(flows).toEqual([]);
    expect(events).toEqual([]);
    expect(BoardView.rowsOf({ data: empty, flows, events, ...none })).toEqual([]);
  });

  test('the rows leave out the owner, CI and reviewers, and an idle agent says it is idle', () => {
    const agents = {
      Ana: agent({}),
      CI: agent({}),
      reviewer: agent({}),
      bo: agent({ current: 'tidy' }),
    };
    const board = data({ agents });
    const rows = BoardView.rowsOf({ data: board, flows: [], events: [], ...none });

    expect(rows.map((row) => [row.n, row.st, row.text])).toEqual([
      ['bo', 'idle', `${en('rảnh · ')}tidy`],
    ]);
  });

  test('working needs a line in the last half hour: a quiet agent is idle whatever its record says', () => {
    const agents = {
      fresh: agent({ state: 'working', checkedAt: '2026-11-03T10:00:00.000Z' }),
      quiet: agent({ state: 'working', checkedAt: '2026-11-03T08:00:00.000Z' }),
    };
    const rows = BoardView.rowsOf({ data: data({ agents }), flows: [], events: [], ...none });

    expect(rows.map((row) => [row.n, row.st])).toEqual([
      ['fresh', 'working'],
      ['quiet', 'idle'],
    ]);
    expect(rows[1].lastAt).toBe('2026-11-03T08:00:00.000Z');
  });

  test('a roster and lanes leave nobody out: every agent has a row, the roster first', () => {
    const agents = { bo: agent({}), cy: agent({}), dee: agent({}) };
    const board = data({ agents, roster: ['dee'], lanes: { cy: 'dee' } });
    const rows = BoardView.rowsOf({ data: board, flows: [], events: [], ...none });

    expect(rows.map((row) => row.n)).toEqual(['dee', 'bo', 'cy']);
  });

  test('an actor of the lines with no record of its own still has a row', () => {
    const board = data({ agents: {}, roster: ['bo'] });
    const lines = [line({ actor: 'cy' }), line({ id: 'b', actor: 'dee' })];
    const rows = BoardView.rowsOf({ data: board, flows: [], events: lines, ...none });

    expect(rows.map((row) => row.n)).toEqual(['cy', 'dee']);
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
