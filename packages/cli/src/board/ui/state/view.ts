import { BoardConstants } from '../../common/index.ts';
import type { IBoardAgent, IBoardData, IBoardEvent, IBoardFlow } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView, TTranslate } from '../common/types.ts';
import { BoardTime } from './time.ts';

const RANK: Record<IBoardAgent['state'], number> = { working: 2, idle: 1 };

/** What the page draws, worked out from the data of a board, with a helper rolled into its lane. */
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

  static laneOf(opts: { data: IBoardData; name: string }): string {
    return opts.data.lanes?.[opts.name] ?? opts.name;
  }

  /** The lines of a flow as drawn: plumbing only when asked for, a helper's line as its lane's. */
  static linesOf(opts: {
    data: IBoardData;
    flow: IBoardFlow;
    showAll: boolean;
  }): IBoardViewEvent[] {
    const { data } = opts;

    return opts.flow.events
      .filter((event) => opts.showAll || !event.plumbing)
      .map((event) => {
        const actor = BoardView.laneOf({ data, name: event.actor });
        const to = event.to === undefined ? undefined : BoardView.laneOf({ data, name: event.to });

        return actor === event.actor && to === event.to
          ? event
          : { ...event, as: event.actor, asTo: event.to, actor, to };
      });
  }

  static eventsOf(opts: { data: IBoardData; showAll: boolean }): IBoardViewEvent[] {
    return opts.data.flows.flatMap((flow) => BoardView.linesOf({ ...opts, flow }));
  }

  /** The flows the list draws; a flow with no line to show is left out. */
  static flowsOf(opts: { data: IBoardData; showAll: boolean; lastSeen: string }): IFlowView[] {
    const views: IFlowView[] = [];

    for (const flow of opts.data.flows) {
      const evs = BoardView.linesOf({ ...opts, flow }).sort(BoardView.byTime);
      const last = evs.find((event) => event.id === flow.lastId) ?? evs.at(-1);

      if (last === undefined) {
        continue;
      }

      const att: IFlowView['att'] = {};

      for (const event of evs.filter((one) => BoardUiConstants.ATTEMPT_KINDS.has(one.kind))) {
        (att[event.stage] ??= []).push(event);
      }

      views.push({
        flow,
        holder: BoardView.laneOf({ data: opts.data, name: flow.holder }),
        evs,
        last,
        att,
        lastAsk: evs.find((event) => event.id === flow.askId),
        dec: opts.data.decisions[flow.id],
        named: flow.named || flow.id === BoardConstants.UNSORTED,
        noWork: !evs.some((event) => !event.plumbing && event.kind !== 'flow'),
        newCount: evs.filter((event) => event.ts > opts.lastSeen).length,
        approxLast: BoardTime.isApproximate({ source: last.source }),
      });
    }

    return views;
  }

  /** The state of each agent, a helper merged into its lane: working beats idle, and the newest line speaks. */
  static docsOf(opts: { data: IBoardData }): Record<string, IBoardAgent> {
    const docs: Record<string, IBoardAgent> = {};

    for (const [name, doc] of Object.entries(opts.data.agents)) {
      const lane = BoardView.laneOf({ data: opts.data, name });
      const was = docs[lane];
      const newer = was === undefined || doc.checkedAt > was.checkedAt ? doc : was;

      if (was === undefined) {
        docs[lane] = doc;
        continue;
      }

      docs[lane] = { ...newer, state: RANK[doc.state] > RANK[was.state] ? doc.state : was.state };
    }

    return docs;
  }

  /** The dock rows: the roster (or everyone), one per lane, by name. */
  static rowsOf(opts: {
    data: IBoardData;
    flows: IFlowView[];
    events: IBoardViewEvent[];
    docs: Record<string, IBoardAgent>;
    showAll: boolean;
    translate: TTranslate;
  }): IAgentRow[] {
    const { data, flows, events, docs, translate } = opts;
    const isShown = (name: string): boolean =>
      name !== '' &&
      name !== data.owner &&
      !BoardUiConstants.NOT_AGENTS.has(name) &&
      (opts.showAll || !data.roster || data.roster.includes(name));
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
        const st = BoardView.stateOf({ doc, blockedFlow, youFlow, runFlow });
        const said = BoardView.saidOf({ st, doc, lastLine, youFlow, translate });

        return {
          n: name,
          helpers: BoardView.helpersOf({ data, events, lane: name }),
          st,
          ...(st === 'you' && youFlow?.lastAsk ? { ask: youFlow.lastAsk.summary } : {}),
          flow: (blockedFlow ?? youFlow)?.flow.id ?? runFlow?.flow.id ?? lastLine?.flowId ?? null,
          ...said,
          key: `${lastLine?.id ?? lastLine?.ts ?? ''}|${doc?.checkedAt ?? ''}|${doc?.current ?? ''}`,
        };
      })
      .sort((left, right) => left.n.localeCompare(right.n));
  }

  private static stateOf(opts: {
    doc?: IBoardAgent;
    blockedFlow?: IFlowView;
    youFlow?: IFlowView;
    runFlow?: IFlowView;
  }): IAgentRow['st'] {
    if (opts.blockedFlow) {
      return 'blocked';
    }

    if (opts.youFlow) {
      return 'you';
    }

    return opts.doc?.state === 'working' || opts.runFlow ? 'working' : 'idle';
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

  /** How many helpers worked under a lane, by the names they have in the data and in the log. */
  private static helpersOf(opts: {
    data: IBoardData;
    events: IBoardViewEvent[];
    lane: string;
  }): number {
    const { data, lane } = opts;
    const named = Object.keys(data.agents).filter(
      (name) => name !== lane && BoardView.laneOf({ data, name }) === lane,
    );
    const logged = opts.events
      .filter((e) => e.as && e.as !== lane && e.actor === lane)
      .map((e) => e.as);

    return new Set([...named, ...logged]).size;
  }
}
