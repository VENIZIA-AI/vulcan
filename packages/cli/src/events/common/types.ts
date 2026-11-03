import type { TConstValue } from '../../common/index.ts';
import type { EventKinds } from './constants.ts';

export type TEventKind = TConstValue<typeof EventKinds>;

/** One line of the log. Field order is the order on disk. */
export interface IEvent {
  id: string;
  /** ISO 8601, UTC. */
  ts: string;
  flowId?: string;
  actor: string;
  kind: TEventKind;
  summary: string;
  ref?: string;
  source: string;
}

/** The manifest's `events` block, as `vulcan sync` writes it. */
export interface IEventSettings {
  log: boolean;
  /** An absolute folder; the log goes here instead of `.agents/local/events` of the project. */
  dir?: string;
}

/** What a hook payload says happened, before the actor, the flow and the id are added. */
export interface IHookEvent {
  kind: TEventKind;
  summary: string;
  ref?: string;
  /** Text a flow id may be read from: the first line of a message. */
  flowText?: string;
}

export interface IEventRead {
  events: IEvent[];
  /** Lines that were not an event; a reader reports the count and goes on. */
  skipped: number;
}
