import type { IBoardData } from '../../common/index.ts';
import type { IBoardViewEvent } from '../common/types.ts';
import { BoardUrl } from '../url.ts';
import { BoardView } from './view.ts';

export interface IOpenPr {
  repo?: string;
  n: number;
  flow: string;
  ci: string | null;
  link: string | null;
}

/** What the card of one agent says beyond its row: its last lines, its open pull requests, the messages nobody answered. */
export class BoardAgentInfo {
  /** Who sent a message line and who got it: a sent line is the actor's to `to`; a received one is the actor's from `from`. */
  static endsOf(opts: { data: IBoardData; message: IBoardViewEvent }): {
    sender?: string;
    receiver?: string;
  } {
    const { message } = opts;

    return message.incoming
      ? {
          sender:
            message.from === undefined
              ? undefined
              : BoardView.laneOf({ data: opts.data, name: message.from }),
          receiver: message.actor,
        }
      : { sender: message.actor, receiver: message.to };
  }

  /** The pull request a link or a repo and number name; only an `https://` link, or one made from `owner/name` and the number. */
  static prHref(opts: { pr: IOpenPr }): string | undefined {
    const { pr } = opts;

    if (BoardUrl.safe({ value: pr.link ?? undefined })) {
      return pr.link ?? undefined;
    }

    return pr.repo && /^[\w.-]+\/[\w.-]+$/.test(pr.repo)
      ? `https://github.com/${pr.repo}/pull/${pr.n}`
      : undefined;
  }

  /** The pull requests the lines speak of, each with who opened it, whether it merged or closed, and the state of its newest check. */
  static prsOf(opts: { events: IBoardViewEvent[] }): (IOpenPr & {
    by?: string;
    merged: boolean;
    closed: boolean;
  })[] {
    const { events } = opts;
    const prs: Record<string, IOpenPr & { by?: string; merged: boolean; closed: boolean }> = {};

    for (const event of events) {
      if (!event.ref?.pr) {
        continue;
      }

      const pr = (prs[`${event.ref.repo ?? ''}#${event.ref.pr}`] ??= {
        repo: event.ref.repo,
        n: event.ref.pr,
        flow: event.flowId,
        ci: null,
        link: null,
        merged: false,
        closed: false,
      });

      pr.by ??= event.kind === 'pr' ? event.actor : undefined;
      pr.merged ||= event.kind === 'merge';
      pr.closed ||= event.status === 'closed';
      pr.ci = event.kind === 'ci' ? (event.status ?? null) : pr.ci;
      pr.link = event.link && /^https:\/\/.+\/pull\//.test(event.link) ? event.link : pr.link;
    }

    return Object.values(prs);
  }

  static of(opts: { data: IBoardData; events: IBoardViewEvent[]; name: string }): {
    mine: IBoardViewEvent[];
    open: IOpenPr[];
    pending: IBoardViewEvent[];
  } {
    const { data, events, name } = opts;
    const messages = events
      .filter((event) => event.kind === 'msg')
      .filter((event) => {
        const { sender, receiver } = BoardAgentInfo.endsOf({ data, message: event });

        return sender === name || receiver === name;
      })
      .sort(BoardView.byTime);

    return {
      mine: events.filter((event) => event.actor === name).sort(BoardView.byTime),
      open: BoardAgentInfo.prsOf({ events }).filter(
        (pr) => pr.by === name && !pr.merged && !pr.closed,
      ),
      // A message waits for its receiver: unanswered while the receiver has done nothing since, in that flow.
      pending: messages.filter((message) => {
        const { receiver } = BoardAgentInfo.endsOf({ data, message });

        return !events.some(
          (event) =>
            event.ts > message.ts &&
            event.actor === receiver &&
            (!message.flowId || event.flowId === message.flowId),
        );
      }),
    };
  }
}
