/** The sizes and words the figures of the sequence, the lifecycle and the tree share. */
export class KindFigureConstants {
  /** The few words these figures say that the page's words may not have yet: English until the chrome has them. */
  static readonly WORDS = {
    kindCall: 'call',
    kindReply: 'reply',
    kindAsync: 'async',
    stateStart: 'start',
    stateEnd: 'end',
    countMessages: 'messages',
    countStates: 'states',
    countTransitions: 'transitions',
    countItems: 'items',
  } as const;

  static readonly MARGIN = 24;
  /** No figure is narrower than this, so on a phone (390 px) the list always takes its place. */
  static readonly MIN_WIDTH = 480;
  static readonly LABEL_PX = 8.2;
  static readonly SMALL_PX = 6.6;
}
