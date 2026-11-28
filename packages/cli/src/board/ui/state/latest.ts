import type { IBoardActivity } from '../../common/index.ts';
import type { TBoardViewEvent, TTranslate } from '../common/types.ts';

/**
 * The verb of each type of log line an agent card can show as its latest; a type with no verb shows its words alone.
 * The types are the log's `EventTypes` values, written out: the page bundle must not take the events constants.
 */
const ACTIVITY_VERBS: Record<string, string> = {
  'session-start': 'lt.sessionStart',
  'subagent-start': 'lt.subagentStart',
  'subagent-stop': 'lt.subagent',
  usage: 'lt.usage',
  commit: 'lt.commit',
  pr: 'lt.pr',
  decision: 'lt.decision',
  flow: 'lt.flow',
  deploy: 'lt.release',
  'needs-owner': 'lt.ask',
};
/** Lines whose words say nothing to a reader: a usage line says `tokens`, a session start its model. */
const WORDLESS = new Set<string>(['usage', 'session-start']);

/** The one sentence the Latest list says of a line. */
export class BoardLatest {
  static textOf(opts: { event: TBoardViewEvent; translate: TTranslate }): string {
    const { event, translate } = opts;
    let verb: string;

    if (event.kind === 'decision' && event.choice) {
      verb = translate(`lt.${event.choice}`);
    } else if (event.kind === 'note') {
      verb = translate(event.needsOwner ? 'lt.ask' : 'lt.note');
    } else if (event.kind === 'msg' && event.incoming) {
      verb = event.from ? `${translate('lt.gotFrom')} ${event.from}` : translate('lt.got');
    } else if (event.kind === 'msg' && event.to) {
      verb = `${translate('lt.msgTo')} ${event.to}`;
    } else {
      verb = translate(`lt.${event.kind}`);
    }

    return `${event.actor} ${verb}${event.summary ? `: ${event.summary}` : ''}`;
  }

  /** What an agent last did, from its newest line of any type, without its name: `wrote to web-lead: the review`. */
  static activityOf(opts: { activity: IBoardActivity; translate: TTranslate }): string {
    const { activity, translate } = opts;
    let verb: string;

    if (activity.type === 'msg-sent') {
      verb = activity.peer ? `${translate('lt.msgTo')} ${activity.peer}` : translate('lt.msg');
    } else if (activity.type === 'msg-received') {
      verb = activity.peer ? `${translate('lt.gotFrom')} ${activity.peer}` : translate('lt.got');
    } else {
      verb = ACTIVITY_VERBS[activity.type] ? translate(ACTIVITY_VERBS[activity.type]) : '';
    }

    const words = WORDLESS.has(activity.type) ? '' : activity.summary;

    return verb && words ? `${verb}: ${words}` : verb || words;
  }
}
