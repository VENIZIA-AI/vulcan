import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GuardDecisions, HookConstants } from './common/index.ts';

/** A command the project says is a database write or a deploy: guard-writes asks on a match. */
export interface IProjectCommandCheck {
  rule: 'V-W-02' | 'V-W-03';
  what: string;
  pattern: RegExp;
}

/** What the project adds to the guards: the manifest's `guard` block, compiled. */
interface IGuardPolicy {
  commands: IProjectCommandCheck[];
  askPush: string[];
  /** `guard.outside`: what guard-outside does with a write outside the project; the strictest of `VULCAN_GUARD_OUTSIDE` and the manifest, `ask` when neither says `deny`. */
  outside: string;
  /**
   * `guard.asks`: `deny` makes every answer that would ask a human a refusal. The strictest of the launch environment
   * (`VULCAN_GUARD_ASKS`), the manifest, and a manifest that exists but cannot be read; `ask` when none says otherwise.
   */
  asks: string;
  /** What the answer adds when an ask is held: which of the three held it; `undefined` when asks stay asks. */
  asksNote?: string;
  /** `guard.toolOwnedPaths`: stores a tool manages itself, which guard-outside lets through. */
  toolOwnedPaths: string[];
  /** `guard.runners.allow`: the package names bunx, `bun x`, npx and `pnpm dlx` may run beyond `@venizia/*`. */
  runnersAllow: string[];
}

/** Spelt out: the blocking hooks import nothing that reads the package. */
const GUARD_MANIFEST_FILE = '.agents/local/vulcan.manifest.json';

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const ruleOf = (opts: { value: unknown }): 'V-W-02' | 'V-W-03' | undefined =>
  opts.value === 'V-W-02' || opts.value === 'V-W-03' ? opts.value : undefined;

const note = (opts: { message: string }): void => {
  console.error(`vulcan: [guard] ${opts.message}`);
};

const commandOf = (opts: { value: unknown }): IProjectCommandCheck | undefined => {
  const holder = { value: opts.value };

  if (!isRecord(holder)) {
    return undefined;
  }

  const rule = ruleOf({ value: holder.value['rule'] });
  const what = holder.value['what'];
  const source = holder.value['pattern'];

  if (rule === undefined || typeof what !== 'string' || what === '' || typeof source !== 'string') {
    note({
      message: 'ignoring a guard.writes.commands entry that has no usable rule, what or pattern',
    });

    return undefined;
  }

  try {
    return {
      rule,
      what,
      pattern: new RegExp(source, holder.value['ignoreCase'] === true ? 'i' : ''),
    };
  } catch (error) {
    note({
      message: `ignoring the pattern '${source}' of guard.writes.commands (${error instanceof Error ? error.message : String(error)})`,
    });

    return undefined;
  }
};

export class ProjectGuards {
  /** The committed manifest, which a hook reads instead of the config. */
  static readonly MANIFEST_FILE = GUARD_MANIFEST_FILE;

  /**
   * The commands and push targets a project lists, from the committed manifest (`vulcan sync` renders
   * them from the config), so a hook reads them with no config loader and no zod. A project with no
   * manifest, or none of the block, has none; an entry that cannot be used is skipped, said once on
   * stderr, and the others stay.
   */
  static readPolicy(opts: {
    root: string;
    env?: Record<string, string | undefined>;
  }): IGuardPolicy {
    const policy = ProjectGuards.readManifest({ root: opts.root });
    const env = opts.env ?? process.env;
    const isEnvAsks = env[HookConstants.ENV_ASKS] === GuardDecisions.DENY;
    const isEnvOutside = env[HookConstants.ENV_OUTSIDE] === GuardDecisions.DENY;
    const isAsksDenied = isEnvAsks || policy.asks === GuardDecisions.DENY;
    // Where the environment holds deny, the manifest is not trusted to loosen anything: the stores it would allow and the runners it would add are ignored.
    const isEnvHeld = isEnvAsks || isEnvOutside;

    return {
      ...policy,
      toolOwnedPaths: isEnvHeld ? [] : policy.toolOwnedPaths,
      runnersAllow: isEnvHeld ? [] : policy.runnersAllow,
      asks: isAsksDenied ? GuardDecisions.DENY : GuardDecisions.ASK,
      asksNote: isEnvAsks ? HookConstants.HELD_ASK_ENV : policy.asksNote,
      outside:
        isEnvOutside || policy.outside === GuardDecisions.DENY
          ? GuardDecisions.DENY
          : GuardDecisions.ASK,
    };
  }

  /** What the manifest sets, before the launch environment tightens it. A manifest that exists and cannot be read holds every ask. */
  private static readManifest(opts: { root: string }): IGuardPolicy {
    const path = join(opts.root, GUARD_MANIFEST_FILE);
    const empty: IGuardPolicy = {
      commands: [],
      askPush: [],
      outside: GuardDecisions.ASK,
      asks: GuardDecisions.ASK,
      toolOwnedPaths: [],
      runnersAllow: [],
    };
    const unreadable: IGuardPolicy = {
      ...empty,
      asks: GuardDecisions.DENY,
      asksNote: HookConstants.MANIFEST_UNREADABLE,
    };

    if (!existsSync(path)) {
      return empty;
    }

    let manifest: unknown;

    try {
      manifest = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      note({
        message: `the manifest could not be read, so the project's own patterns are off and every ask is a deny (${error instanceof Error ? error.message : String(error)})`,
      });

      return unreadable;
    }

    const top = { value: manifest };

    if (!isRecord(top)) {
      note({ message: 'the manifest is not an object, so every ask is a deny' });

      return unreadable;
    }

    const guard = { value: top.value['guard'] };

    if (!isRecord(guard)) {
      return empty;
    }

    const writes = { value: guard.value['writes'] };
    const git = { value: guard.value['git'] };
    const listed = isRecord(writes) ? writes.value['commands'] : undefined;
    const targets = isRecord(git) ? git.value['askPush'] : undefined;
    const owned = guard.value['toolOwnedPaths'];
    const runners = { value: guard.value['runners'] };
    const words = (value: unknown): string[] =>
      (Array.isArray(value) ? value : []).filter(
        (item): item is string => typeof item === 'string' && item !== '',
      );

    return {
      commands: (Array.isArray(listed) ? listed : []).flatMap((entry) => {
        const check = commandOf({ value: entry });

        return check === undefined ? [] : [check];
      }),
      askPush: words(targets),
      outside:
        guard.value['outside'] === GuardDecisions.DENY ? GuardDecisions.DENY : GuardDecisions.ASK,
      asks: guard.value['asks'] === GuardDecisions.DENY ? GuardDecisions.DENY : GuardDecisions.ASK,
      asksNote: guard.value['asks'] === GuardDecisions.DENY ? HookConstants.HELD_ASK : undefined,
      toolOwnedPaths: words(owned),
      runnersAllow: isRecord(runners) ? words(runners.value['allow']) : [],
    };
  }

  /** Whether a branch name is one of the listed names; `*` stands for any run of characters, nothing else is special. */
  static matchesBranch(opts: { name: string; patterns: string[] }): boolean {
    return opts.patterns.some((pattern) =>
      new RegExp(
        `^${pattern
          .split('*')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      ).test(opts.name),
    );
  }
}
