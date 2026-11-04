import type { IBoardAgent, IBoardData, IBoardEvent, IBoardFlow } from '../../common/index.ts';
import { BoardConstants } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView, TTranslate } from '../common/types.ts';
import { BoardTime } from './time.ts';

/** What the page draws, worked out from the data of a board. */
export class BoardView {
  /** Older first; lines of one moment by stage. */
  static byTime(left: IBoardEvent, right: IBoardEvent): number {
    if (left.ts !== right.ts) {
      return left.ts < right.ts ? -1 : 1;
    }

    return left.stage - right.stage;
  }

  /** Whether an agent holds the flow or has a line in it. */
  static involves(opts: { view: IFlowView; name: string }): boolean {
    return (
      opts.view.holder === opts.name ||
      opts.view.evs.some((event) => event.actor === opts.name || event.to === opts.name)
    );
  }

  /** The lines of a flow as drawn: plumbing only when asked for. */
  static linesOf(opts: { flow: IBoardFlow; showAll: boolean }): IBoardViewEvent[] {
    return opts.flow.events.filter((event) => opts.showAll || !event.plumbing);
  }

  static eventsOf(opts: { data: IBoardData; showAll: boolean }): IBoardViewEvent[] {
    return opts.data.flows.flatMap((flow) => BoardView.linesOf({ flow, showAll: opts.showAll }));
  }

  /** The flows the list draws; a flow with no line to show is left out. */
  static flowsOf(opts: { data: IBoardData; showAll: boolean; lastSeen: string }): IFlowView[] {
    const views: IFlowView[] = [];

    for (const flow of opts.data.flows) {
      const evs = BoardView.linesOf({ flow, showAll: opts.showAll }).sort(BoardView.byTime);
      const last = evs.find((event) => event.id === flow.lastId) ?? evs.at(-1);

      if (last === undefined) {
        continue;
      }

      views.push({
        flow,
        holder: flow.holder,
        evs,
        last,
        lastAsk: evs.find((event) => event.id === flow.askId),
        noWork: !evs.some((event) => !event.plumbing && event.kind !== 'flow'),
        newCount: evs.filter((event) => event.ts > opts.lastSeen).length,
      });
    }

    return views;
  }

  /** The agent rows: everyone the log or the agents record names, the roster first, then by name. Nothing is left out. */
  static rowsOf(opts: {
    data: IBoardData;
    flows: IFlowView[];
    events: IBoardViewEvent[];
    translate: TTranslate;
    now: number;
  }): IAgentRow[] {
    const { data, flows, events, translate } = opts;
    const docs = data.agents;
    const isShown = (name: string): boolean =>
      name !== '' && name !== data.owner && !BoardUiConstants.NOT_AGENTS.has(name);
    const listed = data.roster ?? [];
    const rank = (name: string): number =>
      listed.includes(name) ? listed.indexOf(name) : listed.length;
    const names = new Set([
      ...Object.keys(docs).filter(isShown),
      ...events.filter((e) => e.source !== 'github' && isShown(e.actor)).map((e) => e.actor),
    ]);

    return [...names]
      .map((name) => {
        const doc: IBoardAgent | undefined = docs[name];
        const lastLine = events
          .filter((event) => event.actor === name)
          .sort(BoardView.byTime)
          .at(-1);
        const youFlow = flows.find(
          (view) =>
            view.flow.state === 'you' &&
            view.evs.findLast((event) => event.actor !== data.owner)?.actor === name,
        );
        const blockedFlow = flows.find((v) => v.flow.state === 'blocked' && v.holder === name);
        const runFlow = flows.find((v) => v.flow.state === 'running' && v.holder === name);
        const lastAt =
          [doc?.checkedAt, lastLine?.ts]
            .filter((one) => one !== undefined)
            .sort()
            .at(-1) ?? null;
        // Working needs a line within the active gap: after a quiet spell the agent is idle, whatever its record says.
        const quiet =
          lastAt === null || opts.now - Date.parse(lastAt) > BoardConstants.ACTIVE_GAP_MS;
        const st = BoardView.stateOf({ doc, blockedFlow, youFlow, runFlow, quiet });
        const said = BoardView.saidOf({ st, doc, lastLine, youFlow, translate });

        return {
          n: name,
          lastAt,
          st,
          ...(st === 'you' && youFlow?.lastAsk ? { ask: youFlow.lastAsk.summary } : {}),
          flow: (blockedFlow ?? youFlow)?.flow.id ?? runFlow?.flow.id ?? lastLine?.flowId ?? null,
          ...said,
          key: `${lastLine?.id ?? lastLine?.ts ?? ''}|${doc?.checkedAt ?? ''}|${doc?.current ?? ''}`,
        };
      })
      .sort((left, right) => rank(left.n) - rank(right.n) || left.n.localeCompare(right.n));
  }

  private static stateOf(opts: {
    doc?: IBoardAgent;
    blockedFlow?: IFlowView;
    youFlow?: IFlowView;
    runFlow?: IFlowView;
    quiet: boolean;
  }): IAgentRow['st'] {
    if (opts.blockedFlow) {
      return 'blocked';
    }

    if (opts.youFlow) {
      return 'you';
    }

    return !opts.quiet && (opts.doc?.state === 'working' || opts.runFlow) ? 'working' : 'idle';
  }

  /** What a row says and since when: the ask that waits, a newer note of the agent, its last line, or nothing yet. */
  private static saidOf(opts: {
    st: IAgentRow['st'];
    doc?: IBoardAgent;
    lastLine?: IBoardViewEvent;
    youFlow?: IFlowView;
    translate: TTranslate;
  }): Pick<IAgentRow, 'text' | 'ts' | 'approx'> {
    const { st, doc, lastLine, youFlow, translate } = opts;
    const time = (iso?: string): number => (iso ? Date.parse(iso) || 0 : 0);
    const line = (event: IBoardViewEvent, text: string) => ({
      text,
      ts: event.ts,
      approx: BoardTime.isApproximate({ source: event.source }),
    });
    let said: Pick<IAgentRow, 'text' | 'ts' | 'approx'>;

    if (st === 'you' && youFlow?.lastAsk) {
      said = line(youFlow.lastAsk, `${translate('chờ anh: ')}${youFlow.lastAsk.summary}`);
    } else if (doc?.current && (!lastLine || time(doc.checkedAt) > time(lastLine.ts))) {
      said = { text: doc.current, ts: doc.since, approx: false };
    } else if (lastLine) {
      said = line(lastLine, lastLine.summary);
    } else {
      said = {
        text: doc?.current === '' || doc === undefined ? translate('chưa có việc') : doc.current,
        ts: doc?.since ?? null,
        approx: false,
      };
    }

    return st === 'idle' && !BoardUiConstants.IDLE_TEXT.test(said.text)
      ? { ...said, text: `${translate('rảnh · ')}${said.text}` }
      : said;
  }
}
