/**
 * The environment a pack-smoke step runs in: the caller's, without the variables that carry the owner's own choices for
 * their own session (`VULCAN_OWNER_REPLY=off`, `VULCAN_GUARDS`, `VULCAN_ACTOR`, `CLAUDE_PROJECT_DIR`, ...). The smoke tests the
 * packed tarball as a stranger installs it, so what a shell exports must not change the verdict. A step that needs one of
 * these names sets it in `extra`.
 */
export class SmokeEnv {
  /** A name that starts with one of these belongs to VULCAN or to Claude Code. */
  private static readonly OWNER_PREFIXES = ['VULCAN_', 'CLAUDE'];

  static of(opts: {
    env: Record<string, string | undefined>;
    extra?: Record<string, string>;
  }): Record<string, string> {
    const kept = Object.entries(opts.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !SmokeEnv.OWNER_PREFIXES.some((prefix) => entry[0].startsWith(prefix)),
    );

    return { ...Object.fromEntries(kept), ...opts.extra };
  }
}
