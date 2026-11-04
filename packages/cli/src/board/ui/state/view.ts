import type { IBoardAgent, IBoardData, IBoardEvent } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView, TTranslate } from '../common/types.ts';
import { BoardTime } from './time.ts';

const byTime = (left: IBoardEvent, right: IBoardEvent): number =>
  left.ts < right.ts ? -1 : left.ts > right.ts ? 1 : left.stage - right.stage;

/** What the page draws, worked out from the data of a board: flows, lines and agents, with a helper rolled into its lane. */
export class BoardView {
  /** The lane of a helper, or the name itself. */
  static laneOf<TName extends string | undefined>(opts: { data: IBoardData; name: TName }): TName {
    const lane = opts.name === undefined ? undefined : opts.data.lanes?.[opts.name];

    return lane === undefined ? opts.name : (lane as TName);
  }

  /** The line as its lane's when its sender or its recipient is a helper; the helper's own names stay in `as` and `asTo`. */
  static viewOf(opts: { data: IBoardData; event: IBoardEvent }): IBoardViewEvent {
    const { data, event } = opts;
    const actor = BoardView.laneOf({ data, name: event.actor });
    const to = BoardView.laneOf({ data, name: event.to });

    return actor === event.actor && to === event.to
      ? event
      : { ...event, as: event.actor, asTo: event.to, actor, to };
  }

  /** Every line of every flow as the page draws it; plumbing only when the owner asked for all events. */
  static eventsOf(opts: { data: IBoardData; showAll: boolean }): IBoardViewEvent[] {
    return opts.data.flows
      .flatMap((flow) => flow.events)
      .filter((event) => opts.showAll || !event.plumbing)
      .map((event) => BoardView.viewOf({ data: opts.data, event }));
  }

  /** The flows the list draws. A flow with no line to show is left out. */
  static flowsOf(opts: { data: IBoardData; showAll: boolean; lastSeen: string }): IFlowView[] {
    const { data } = opts;
    const views: IFlowView[] = [];

    for (const flow of data.flows) {
      const evs = flow.events
        .filter((event) => opts.showAll || !event.plumbing)
        .map((event) => BoardView.viewOf({ data, event }))
        .sort(byTime);
      const last = evs.find((event) => event.id === flow.lastId) ?? evs.at(-1);

      if (last === undefined) {
        continue;
      }

      const att: Record<number, IBoardViewEvent[]> = {};

      for (const event of evs) {
        if (BoardUiConstants.ATTEMPT_KINDS.has(event.kind)) {
          (att[event.stage] ??= []).push(event);
        }
      }

      const fresh = evs.filter((event) => event.ts > opts.lastSeen);

      views.push({
        id: flow.id,
        noWork: !evs.some((event) => !event.plumbing && event.kind !== 'flow'),
        title: {
          title: flow.title,
          repo: flow.repo,
          why: flow.why,
          context: flow.context,
          next: flow.next,
          named: flow.named || flow.id === 'Unsorted',
        },
        evs,
        last,
        state: flow.state,
        holder: BoardView.laneOf({ data, name: flow.holder }),
        stages: flow.stages,
        cur: flow.cur,
        att,
        lastAsk:
          flow.askId === undefined ? undefined : evs.find((event) => event.id === flow.askId),
        dec: data.decisions[flow.id],
        unread: fresh.length > 0,
        newCount: fresh.length,
        approxLast: BoardTime.isApproximate({ source: last.source }),
      });
    }

    return views;
  }

  /** The state of each agent, with the state of a helper merged into its lane: working beats idle, and the newest line speaks. */
  static docsOf(opts: { data: IBoardData }): Record<string, IBoardAgent> {
    const docs: Record<string, IBoardAgent> = {};

    for (const [name, doc] of Object.entries(opts.data.agents)) {
      const lane = BoardView.laneOf({ data: opts.data, name });
      const was = docs[lane];

      if (was === undefined) {
        docs[lane] = doc;
        continue;
      }

      const newer = doc.checkedAt > was.checkedAt ? doc : was;
      const rank = BoardUiConstants.STATE_RANK;

      docs[lane] = {
        ...newer,
        state: (rank[doc.state] ?? 0) > (rank[was.state] ?? 0) ? doc.state : was.state,
      };
    }

    return docs;
  }

  /** The rows of the dock and the graph: the roster (or everyone), one row per lane, sorted by name. */
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
      Boolean(name) &&
      name !== data.owner &&
      !BoardUiConstants.NOT_AGENTS.has(name) &&
      (opts.showAll || !data.roster || data.roster.includes(name));
    const names = new Set([
      ...Object.keys(docs).filter(isShown),
      ...events
        .filter((event) => event.source !== 'github' && isShown(event.actor))
        .map((event) => event.actor),
    ]);
    const time = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

    return [...names]
      .map((name): IAgentRow => {
        const doc = docs[name];
        const lastLine = events
          .filter((event) => event.actor === name)
          .sort(byTime)
          .at(-1);
        const youFlow = flows.find(
          (flow) =>
            flow.state === 'you' &&
            [...flow.evs].reverse().find((event) => event.actor !== data.owner)?.actor === name,
        );
        const blockedFlow = flows.find((flow) => flow.state === 'blocked' && flow.holder === name);
        const runFlow = flows.find((flow) => flow.state === 'running' && flow.holder === name);
        const state = blockedFlow
          ? 'blocked'
          : youFlow
            ? 'you'
            : doc?.state === 'working' || runFlow
              ? 'working'
              : 'idle';
        const docNewer = !!doc?.current && (!lastLine || time(doc.checkedAt) > time(lastLine.ts));
        const row = { text: '', ts: null as string | null, approx: false };

        if (state === 'you' && youFlow?.lastAsk) {
          row.text = `${translate('chờ anh: ')}${youFlow.lastAsk.summary}`;
          row.ts = youFlow.lastAsk.ts;
          row.approx = BoardTime.isApproximate({ source: youFlow.lastAsk.source });
        } else if (docNewer && doc) {
          row.text = doc.current;
          row.ts = doc.since || doc.checkedAt;
        } else if (lastLine) {
          row.text = lastLine.summary;
          row.ts = lastLine.ts;
          row.approx = BoardTime.isApproximate({ source: lastLine.source });
        } else {
          row.text = doc?.current || translate('chưa có việc');
          row.ts = doc?.since || null;
        }

        if (state === 'idle' && !BoardUiConstants.IDLE_TEXT.test(row.text)) {
          row.text = `${translate('rảnh · ')}${row.text}`;
        }

        return {
          n: name,
          helpers: BoardView.helpersOf({ data, events, lane: name }),
          st: state,
          flow: (blockedFlow ?? youFlow)?.id ?? runFlow?.id ?? lastLine?.flowId ?? null,
          text: row.text,
          ts: row.ts,
          approx: row.approx,
          compact: state === 'idle',
          key: `${lastLine ? lastLine.id || lastLine.ts : ''}|${doc?.checkedAt ?? ''}|${doc?.current ?? ''}`,
        };
      })
      .sort((left, right) => left.n.localeCompare(right.n));
  }

  /** How many helpers did something under a lane, by the names they have in the log. */
  private static helpersOf(opts: {
    data: IBoardData;
    events: IBoardViewEvent[];
    lane: string;
  }): number {
    const { data, events, lane } = opts;
    const helpers = new Set<string>();

    for (const name of Object.keys(data.agents)) {
      if (name !== lane && BoardView.laneOf({ data, name }) === lane) {
        helpers.add(name);
      }
    }

    for (const event of events) {
      if (event.as && event.as !== lane && event.actor === lane) {
        helpers.add(event.as);
      }
    }

    return helpers.size;
  }
}
