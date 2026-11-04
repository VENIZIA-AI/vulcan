/** The `VULCAN_` and `CLAUDE_` environment variables (and `CLAUDECODE`) the cli reads; it reads others, such as `HOME` and `TMPDIR`, that are not its own. The test of this class keeps the list complete, and the generated reference is to read the comment above each name. */
export class EnvVariables {
  /** The name of the writer of an event line; it wins over the name Claude Code gave the session. */
  static readonly VULCAN_ACTOR = 'VULCAN_ACTOR';
  /** `off` turns the daily automatic clean of `.agents/local/` off for the shell. */
  static readonly VULCAN_AUTO_CLEAN = 'VULCAN_AUTO_CLEAN';
  /** `off` takes the session out of the owner reply shape; `vulcan doctor` notes it when the shell has it. */
  static readonly VULCAN_OWNER_REPLY = 'VULCAN_OWNER_REPLY';
  /** `off` switches the guard hooks off for one session. */
  static readonly VULCAN_GUARDS = 'VULCAN_GUARDS';
  /** `1` makes `init`, `add` and `upgrade` print the install, `git init`, `sync` and the checks as skipped; for tests. */
  static readonly VULCAN_NO_INSTALL = 'VULCAN_NO_INSTALL';
  /** Set by `vulcan x` for okf and atlas: the resolved project config as JSON. */
  static readonly VULCAN_CONFIG = 'VULCAN_CONFIG';
  /** Set by `vulcan x` for atlas: the manifest, rendered fresh from the config on each run. */
  static readonly VULCAN_MANIFEST = 'VULCAN_MANIFEST';
  /** Set by `vulcan x` for okf and atlas: the project root. */
  static readonly VULCAN_PROJECT_ROOT = 'VULCAN_PROJECT_ROOT';
  /** Replaces the `bun` that `init` and `add` run; for tests. */
  static readonly VULCAN_BUN = 'VULCAN_BUN';
  /** Replaces the `git` that `init` and `add` run; for tests. */
  static readonly VULCAN_GIT = 'VULCAN_GIT';
  /** The dist-tags of `@venizia/vulcan` as JSON, in place of the registry read of `upgrade --nightly`; for tests. */
  static readonly VULCAN_DIST_TAGS = 'VULCAN_DIST_TAGS';
  /** The project root, set by Claude Code for its hooks and by the guard extension for the hooks it runs; without it the hooks use the working directory. */
  static readonly CLAUDE_PROJECT_DIR = 'CLAUDE_PROJECT_DIR';
  /** Where Claude Code puts its task output; the launch file points it at `.agents/local/tmp`, and `vulcan doctor` warns when it points elsewhere. */
  static readonly CLAUDE_CODE_TMPDIR = 'CLAUDE_CODE_TMPDIR';
  /** The file Claude Code hands a start hook to export variables from; the session-start hook appends `export TMPDIR=...` to it. */
  static readonly CLAUDE_ENV_FILE = 'CLAUDE_ENV_FILE';
  /** The id of the running Claude Code session, used to find the session's name for the event actor. */
  static readonly CLAUDE_CODE_SESSION_ID = 'CLAUDE_CODE_SESSION_ID';
  /** The folder whose `sessions/*.json` names the sessions (default `~/.claude`), read to find the session's name. */
  static readonly CLAUDE_CONFIG_DIR = 'CLAUDE_CONFIG_DIR';
  /** Set by Claude Code in the shell of a session it starts; `vulcan doctor` uses it to know it runs inside one. */
  static readonly CLAUDECODE = 'CLAUDECODE';
}
