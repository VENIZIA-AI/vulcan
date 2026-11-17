/** What the name of an actor says about its session. It imports nothing: the board page is built from it. */
export class EventActorNames {
  /** Where the log goes for a hook that has no better answer: the name of an actor with no session name. */
  static readonly UNKNOWN = 'unknown';
  /** What the actor of a session with no name starts with; a name that starts with it is read as no name. */
  static readonly UNNAMED_PREFIX = 'claude:';

  /** Whether the actor is a name somebody gave, and not the fallback of a session with none (`claude:<id>`, `unknown`). */
  static isNamed(opts: { actor: string }): boolean {
    return opts.actor !== this.UNKNOWN && !opts.actor.startsWith(this.UNNAMED_PREFIX);
  }
}
