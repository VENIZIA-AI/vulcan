import { z } from 'zod';
import { GuardDecisions } from '../../../hooks/common/constants.ts';
import { REMOVED_OKF_KEY } from '../../common/schema.ts';

const compiles = (value: string): boolean => {
  try {
    return new RegExp(value) instanceof RegExp;
  } catch {
    return false;
  }
};

/** A command the project says is a database write (V-W-02) or a deploy (V-W-03): guard-writes asks when its pattern matches. */
const GUARD_COMMAND = z.strictObject({
  /** Which rule the command falls under: `V-W-02` for a database write, `V-W-03` for a deploy. */
  rule: z.enum(['V-W-02', 'V-W-03']),
  /** Short name of the action, shown when guard-writes asks; 1 to 120 characters. */
  what: z.string().min(1).max(120),
  /** JavaScript regular expression, 1 to 500 characters, matched against a shell command; guard-writes asks when it matches. */
  pattern: z
    .string()
    .min(1)
    .max(500)
    .refine(compiles, { message: 'a regular expression (JavaScript syntax)' }),
  /** `true` matches `pattern` without regard to case; default: case-sensitive. */
  ignoreCase: z.boolean().optional(),
});

/** A branch a plain `git push` asks about: a name, with `*` for any run of characters. */
const PUSH_TARGET = z
  .string()
  .regex(/^[A-Za-z0-9._/*-]+$/, { message: 'a branch name, with * for any run of characters' });

export const GUARD_SECTION = {
  /**
   * The hooks that guard writes. `toolOwnedPaths` extends the defaults (package manager caches, the
   * runtime dir for locks, git config, the agent tool's memory) with stores a tool in this project
   * manages itself: absolute globs, `~` and `$NAME` allowed. `writes.commands` adds the
   * project's own deploy and migrate commands to what guard-writes asks about (a pattern, matched inside
   * compound commands too), and `git.askPush` lists the branches a plain `git push` asks about; `vulcan project sync`
   * writes both to the manifest, where the hooks read them, and writes `outside` (when it is `deny`) and
   * `toolOwnedPaths` there too, so a config this VULCAN cannot parse changes no guard. `outside` is what
   * `guard-outside` does with a write outside the project: `ask` (the default) or `deny`. `asks` is the same choice for every guard:
   * `deny` makes each answer that would ask a human (a command of guard-writes, a push target of `git.askPush`, `git push --mirror`,
   * `git reset --hard`, a force-push to a branch that is not protected, a force-delete of an unmerged branch, a write outside the
   * project, a part of a call a guard cannot read, a guard that crashed or timed out) a refusal with the same hint. Where the agent
   * runs in an auto mode an ask can be approved without the owner seeing it, so a project that runs agents there sets `asks: 'deny'`.
   * Both are a drift guard, not a boundary: the owner's choice belongs in the launch environment (`VULCAN_GUARD_ASKS=deny`,
   * `VULCAN_GUARD_OUTSIDE=deny`), where the strictest of the environment and the manifest holds and nothing in the project can
   * loosen it (it also ignores `toolOwnedPaths` and `runners.allow` of the manifest, and every hook runs with `bun --no-env-file
   * --config=/dev/null`). `guard-outside` denies an agent's write to the manifest, `.configs/vulcan.config.*`, `.claude/settings*.json` and
   * `node_modules/@venizia/vulcan`.
   */
  guard: z
    .strictObject({
      /** Absolute globs (`~` and `$NAME` allowed) of tool-managed stores, added to the built-in list; default `[]`. */
      toolOwnedPaths: z.array(z.string().min(1)).default([]),
      /** What guard-outside does with a write outside the project: `ask` or `deny`; default `ask`. */
      outside: z.enum([GuardDecisions.ASK, GuardDecisions.DENY]).default(GuardDecisions.ASK),
      /** What every guard does with a call that needs a human to confirm it: `ask` or `deny`; default `ask`. Set `deny` where the agent runs in an auto mode; `VULCAN_GUARD_ASKS=deny` in the launch environment holds it where the project cannot. */
      asks: z.enum([GuardDecisions.ASK, GuardDecisions.DENY]).default(GuardDecisions.ASK),
      /** Write guard list: the project's own deploy and migrate commands; default `[]`. */
      writes: z
        .strictObject({
          /** Removed with the script reading of guard-writes: the key is refused with what to do. */
          trustedScripts: REMOVED_OKF_KEY({
            fix: 'delete this key; guard-writes no longer reads scripts, it asks only for the commands of its table and of guard.writes.commands',
          }),
          /** The project's own deploy and migrate commands guard-writes asks about; default `[]`. */
          commands: z.array(GUARD_COMMAND).default([]),
        })
        .default({ commands: [] }),
      /** Git guard settings; `askPush` lists the branches a plain `git push` asks about, `*` for any run of characters. Default `[]`. */
      git: z.strictObject({ askPush: z.array(PUSH_TARGET).default([]) }).default({ askPush: [] }),
      /**
       * The package names `vulcan check runners` and the runner guard accept besides the scoped packages (`@scope/name`,
       * which always pass), such as `shadcn`: lower-case words, dots and dashes, or a scoped name. Anything else that
       * `bunx`, `bun x`, `npx`, `pnpx` or `pnpm dlx` would fetch by name is refused. Default `[]`.
       */
      runners: z
        .strictObject({
          /** The unscoped names a project may run by name, with a version or a tag after them. */
          allow: z
            .array(z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/))
            .default([]),
        })
        .default({ allow: [] }),
    })
    .default({
      toolOwnedPaths: [],
      outside: GuardDecisions.ASK,
      asks: GuardDecisions.ASK,
      writes: { commands: [] },
      git: { askPush: [] },
      runners: { allow: [] },
    }),
};
