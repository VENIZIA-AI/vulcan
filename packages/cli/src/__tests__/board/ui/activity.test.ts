import { describe, expect, test } from 'bun:test';
import type { IBoardData } from '../../../board/common/index.ts';
import { BoardFold } from '../../../board/fold.ts';
import { BoardLanguages } from '../../../board/ui/common/constants.ts';
import type { IBoardViewEvent } from '../../../board/ui/common/types.ts';
import { BoardI18n } from '../../../board/ui/i18n/translate.ts';
import { BoardAgentInfo } from '../../../board/ui/state/agent-info.ts';
import { BoardCards } from '../../../board/ui/state/cards.ts';
import { BoardLatest } from '../../../board/ui/state/latest.ts';
import { BoardView } from '../../../board/ui/state/view.ts';
import { EventLog } from '../../../events/log.ts';
import { line } from '../log-lines.helper.ts';

const en = (key: string): string => BoardI18n.translate({ language: BoardLanguages.EN, key });
const vi = (key: string): string => BoardI18n.translate({ language: BoardLanguages.VI, key });
const commit = line({
  minute: 0,
  kind: 'commit',
  actor: 'api-lead',
  flow: 'F-1',
  summary: 'the bucket',
  ref: 'abc1234',
});
const usage = EventLog.build({
  kind: 'usage',
  summary: 'tokens',
  actor: 'api-lead',
  source: 'claude-hook',
  flowId: 'F-1',
  now: Date.parse(commit.ts) + 40 * 60_000,
});

describe('an agent card: state and latest from the newest line of any type', () => {
  test('a usage line hours after the last summary makes the agent working now, with the usage as its latest', () => {
    const { agents } = BoardFold.fromLog({ events: [commit, usage] });

    expect(agents['api-lead']).toMatchObject({
      state: 'working',
      checkedAt: usage.ts,
      current: 'the bucket',
      latest: { type: 'usage', ts: usage.ts },
    });
  });

  test('a subagent stop and a sent message are each the newest activity, with the other end of the message', () => {
    const stop = line({ minute: 50, kind: 'subagent-stop', actor: 'api-lead', summary: 'Explore' });
    const sent = line({
      minute: 55,
      kind: 'msg-sent',
      actor: 'api-lead',
      flow: 'F-1',
      summary: 'ready for review',
      ref: 'to:web-lead',
    });

    expect(BoardFold.fromLog({ events: [commit, stop] }).agents['api-lead'].latest).toMatchObject({
      type: 'subagent-stop',
      summary: 'Explore',
    });
    expect(BoardFold.fromLog({ events: [commit, stop, sent] }).agents['api-lead']).toMatchObject({
      checkedAt: sent.ts,
      latest: { type: 'msg-sent', peer: 'web-lead', summary: 'ready for review' },
    });
  });

  test('the harness waiting for a prompt is not activity', () => {
    const prompt = line({
      minute: 70,
      kind: 'needs-owner',
      actor: 'api-lead',
      flow: 'F-1',
      summary: 'idle_prompt',
    });

    expect(BoardFold.fromLog({ events: [commit, prompt] }).agents['api-lead']).toMatchObject({
      checkedAt: commit.ts,
      latest: { type: 'commit' },
    });
  });

  test('the latest line is said in words, in both languages, never as "tokens"', () => {
    const say = (type: string, translate: (key: string) => string, peer?: string): string =>
      BoardLatest.activityOf({
        activity: {
          type,
          ts: commit.ts,
          summary: type === 'usage' ? 'tokens' : 'the bucket',
          peer,
        },
        translate,
      });

    expect(say('usage', en)).toBe('recorded token use');
    expect(say('usage', vi)).toBe('ghi token');
    expect(say('commit', en)).toBe('committed: the bucket');
    expect(say('msg-received', en, 'web-lead')).toBe('got a message from web-lead: the bucket');
    expect(say('msg-sent', vi, 'web-lead')).toBe('nhắn cho web-lead: the bucket');
    expect(say('subagent-stop', en)).toBe('a subagent finished: the bucket');
  });
});

describe('a message not replied yet: delivered when the receiver logged it', () => {
  const sent: IBoardViewEvent = {
    id: 's',
    flowId: 'F-1',
    ts: commit.ts,
    kind: 'msg',
    stage: -1,
    actor: 'web-lead',
    to: 'api-lead',
    summary: 'ready?',
    source: 'cli',
  };
  const got: IBoardViewEvent = {
    ...sent,
    id: 'g',
    actor: 'api-lead',
    to: undefined,
    from: 'web-lead',
    incoming: true,
  };

  test('a sent line is delivered once the receiver has a received line with its words', () => {
    expect(BoardAgentInfo.isDelivered({ message: sent, events: [sent] })).toBe(false);
    expect(BoardAgentInfo.isDelivered({ message: sent, events: [sent, got] })).toBe(true);
    expect(BoardAgentInfo.isDelivered({ message: got, events: [got] })).toBe(true);
  });

  test('the words say replied or not yet, never that it was not received', () => {
    for (const translate of [en, vi]) {
      const words = [
        translate('ag.pending'),
        translate('ag.notReplied'),
        translate('ag.notRepliedYet'),
        translate('ag.delivered'),
      ].join(' ');

      expect(words).not.toMatch(/unanswered|not received|chưa nhận|tin chờ/i);
    }

    expect(en('ag.pending')).toBe('Not replied yet');
    expect(vi('ag.pending')).toBe('Chưa trả lời');
  });
});

describe('a message shows once on the agents pane, under its sender', () => {
  test('the sender card has it as its latest message; the receiver card does not repeat it', () => {
    const sent = line({
      minute: 5,
      kind: 'msg-sent',
      actor: 'web-lead',
      flow: 'F-1',
      summary: 'design review at 3 pm',
      ref: 'to:api-lead',
    });
    const log = BoardFold.fromLog({ events: [commit, sent] });
    const { flows } = BoardFold.fold({ events: log.events, owner: 'Ana' });
    const data: IBoardData = {
      title: 't',
      owner: 'Ana',
      key: 'k',
      shapes: {},
      generatedAt: sent.ts,
      since: commit.ts,
      flows,
      decisions: {},
      agents: log.agents,
      sources: [],
    };
    const views = BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
    const events = BoardView.eventsOf({ data, showAll: false });
    const now = Date.parse(sent.ts);
    const rows = BoardView.rowsOf({ data, flows: views, events, translate: en, now });
    const cardOf = (name: string) => {
      const row = rows.find((one) => one.n === name);

      if (row === undefined) {
        throw new Error(`no row for ${name}`);
      }

      return BoardCards.agentOf({ data, events, views, row, doc: data.agents[name], now });
    };

    expect(cardOf('api-lead').message).toBeUndefined();
    // The sender's newest line is the message itself, so it is its Latest, not a second row.
    expect(cardOf('web-lead').activity).toMatchObject({ type: 'msg-sent', peer: 'api-lead' });
    expect(cardOf('web-lead').message).toBeUndefined();
  });
});
