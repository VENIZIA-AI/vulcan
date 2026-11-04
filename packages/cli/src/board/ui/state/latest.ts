import type { IBoardViewEvent, TTranslate } from '../common/types.ts';

/** The one sentence the Latest list says of a line. */
export class BoardLatest {
  static textOf(opts: { event: IBoardViewEvent; translate: TTranslate }): string {
    const { event, translate } = opts;
    let verb: string;

    if (event.kind === 'decision' && event.choice) {
      verb = translate(`lt.${event.choice}`);
    } else if (event.kind === 'note') {
      verb = translate(event.needsOwner ? 'lt.ask' : 'lt.note');
    } else if (event.kind === 'msg' && event.incoming) {
      verb = event.from ? `${translate('lt.gotFrom')} ${event.from}` : translate('lt.got');
    } else if (event.kind === 'msg' && event.to) {
      verb = `${translate('lt.msgTo')} ${event.asTo ?? event.to}`;
    } else {
      verb = translate(`lt.${event.kind}`);
    }

    return `${event.as ?? event.actor} ${verb}${event.summary ? `: ${event.summary}` : ''}`;
  }
}
