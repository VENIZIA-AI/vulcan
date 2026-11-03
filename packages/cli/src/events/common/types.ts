import type { TConstValue } from '../../common/index.ts';
import type { EventKinds, EventStatuses } from './constants.ts';

export type TEventKind = TConstValue<typeof EventKinds>;
export type TEventStatus = TConstValue<typeof EventStatuses>;

/** One line of the log. Field order is the order on disk. */
export interface IEvent {
  id: string;
  /** ISO 8601, UTC. */
  ts: string;
  flowId?: string;
  actor: string;
  kind: TEventKind;
  summary: string;
  /** Only a `decision` has one. */
  status?: TEventStatus;
  ref?: string;
  source: string;
}

/** The manifest's `events` block, as `vulcan sync` writes it. */
/** How much of the log is kept: whole day files are removed, oldest first, past any of these. */
export interface IEventLimits {
  maxBytes: number;
  maxFiles: number;
  maxAgeDays: number;
}

export interface IEventSettings {
  log: boolean;
  /** The limits the manifest sets; a missing one takes its default when the log is on. */
  maxSize?: string;
  maxFiles?: number;
  maxAgeDays?: number;
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
