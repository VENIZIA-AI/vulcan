import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { HookConstants } from './common/index.ts';
import { TrustStates } from './common/index.ts';
import type { IHookCommand, IReadOnlyScript, IWriteCheck, IWriteHit } from './common/index.ts';
import { commandTextsOf } from './command-view.ts';
import { forHost } from './decision.ts';
import type { IProjectCommandCheck } from './project-guards.ts';
import { basenameOf, parseShell, programOf } from './shell.ts';
import { listedScriptOf, ReadOnlyScripts, ScriptPaths, trustOf } from './trusted-scripts.ts';

const MUTATING_VERB = '(?:POST|PUT|PATCH|DELETE)';

/** Ordered by how much damage the action does. */
const COMMAND_CHECKS: IWriteCheck[] = [
  {
    rule: 'V-W-03',
    what: 'deploying or hot-applying to a cluster',
    pattern:
      /\bkubectl\s+(apply|patch|delete|scale|rollout)\b|\bdocker\s+compose\s+(up|down|restart)\b|\.\/kc\s+(apply|patch|delete)\b/,
  },
  {
    rule: 'V-W-02',
    what: 'running a migration instead of handing it to the human',
    pattern:
      /\bdb:migrate\b|\bmigrate:(dev|local|alpha|develop)\b|drizzle-kit\s+(push|migrate)\b|make\s+db-migrate\b/,
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern:
      /\b(psql|mysql|mongosh|sqlite3)\b[^|]*?\b(insert|update|delete|truncate|drop|alter|create|grant|revoke)\s/i,
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database through a SQL file whose contents this check cannot see',
    pattern: /\b(psql|mysql)\b[^|]*\s-f\s/,
  },
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: /\bcurl\b[^|]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|--upload-file|-d\s)/i,
  },
];

/** A `bun x.ts` command hides its real work inside the file, so the file is read too. */
const SCRIPT_CHECKS: IWriteCheck[] = [
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(
      [
        `method\\s*:\\s*['"\`]${MUTATING_VERB}['"\`]`,
        '\\.(?:post|put|patch|delete)\\s*\\(',
        `['"\`]${MUTATING_VERB}['"\`]\\s*,\\s*['"\`]/`,
      ].join('|'),
      'i',
    ),
  },
  {
    rule: 'V-W-02',
    what: 'calling an endpoint that mutates data',
    pattern: new RegExp(`(?=[\\s\\S]*\\bfetch\\s*\\()[\\s\\S]*['"\`]${MUTATING_VERB}['"\`]`, 'i'),
  },
  {
    rule: 'V-W-02',
    what: 'writing to a database',
    pattern:
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i,
  },
];

const extractScriptTargets = (opts: { command: string }): string[] =>
  [...opts.command.matchAll(/\bbun\s+(?:run\s+)?(\S+\.ts)\b/g)].map((match) => match[1]);

/**
 * The files a script word can mean. `bun x.ts` opens the path as the OS does, following a link before a `..`;
 * `bun run x.ts` folds the `..` as text first. Both are read, so neither spelling hides the other.
 */
const scriptPathsOf = (opts: { target: string; cwd: string }): string[] => [
  ...new Set([ScriptPaths.targetPath(opts), resolve(opts.cwd, opts.target)]),
];

/** The text of a regular file; a folder, a pipe and a missing path read as nothing, so nothing is opened that can block. */
const readScript = (opts: { path: string }): string | undefined =>
  existsSync(opts.path) && statSync(opts.path).isFile()
    ? readFileSync(opts.path, 'utf8')
    : undefined;

/**
 * Every reason `command` looks like a write the base rules reserve for a human (V-W-02, V-W-03).
 * `trust` lists the scripts the project vouches for (`guard.writes.trustedScripts`, repo-relative, under
 * `root`): a listed script that is tracked and identical to HEAD skips the script checks only. The checks
 * on the command line itself always run, and a listed script that git says changed is checked like any other.
 * `trust.readOnlyScripts` (`guard.writes.trustedScripts` objects, from the manifest) skips them for one call: the
 * word right after the script is one of the entry's `readOnly` words and the script is tracked and equals HEAD.
 */
export const inspectCommand = (opts: {
  command: string;
  cwd: string;
  trust?: { root: string; scripts: string[]; readOnlyScripts?: IReadOnlyScript[] };
  /** The project's own commands (`guard.writes.commands`), checked beside the fixed list. */
  extra?: IProjectCommandCheck[];
}): IWriteHit[] => {
  // The patterns run on what the command runs, not on its text: a heredoc written to a file, the pattern
  // of an `rg` and a commit message are data.
  const texts = commandTextsOf({ command: opts.command, withMessages: true });
  const checks: IWriteCheck[] = [
    ...COMMAND_CHECKS,
    ...(opts.extra ?? []).map((check) => ({
      rule: check.rule,
      what: `${check.what} (this project's pattern)`,
      pattern: check.pattern,
    })),
  ];
  const hits: IWriteHit[] = checks
    .filter((check) => texts.some((text) => check.pattern.test(text)))
    .map((check) => ({
      rule: check.rule,
      message: check.what,
    }));

  const targets = extractScriptTargets({ command: texts.join('\n') });
  const entries = opts.trust?.readOnlyScripts ?? [];
  // A subcommand counts only when the shell's own words give the same scripts in the same order as the text
  // does; any other line (a script named in an argument, a pipe into a runner) is read as a whole.
  const invocations = ReadOnlyScripts.extractInvocations({ command: opts.command });
  const isPaired =
    invocations.length === targets.length &&
    invocations.every((invocation, index) => invocation.script === targets[index]);
  const hasMoving = texts.some((text) =>
    parseShell({ command: text }).some((command) =>
      ReadOnlyScripts.MOVING_COMMANDS.has(basenameOf({ word: programOf({ command }).name })),
    ),
  );

  for (const [index, target] of targets.entries()) {
    const sources = scriptPathsOf({ target, cwd: opts.cwd })
      .map((path) => readScript({ path }))
      .filter((text): text is string => text !== undefined);

    if (sources.length === 0) {
      continue;
    }

    const subcommand = isPaired ? invocations[index]?.subcommand : undefined;
    // After a `cd` the hook does not know the folder a relative script word is from, so no entry covers it.
    const isFromUnknownFolder =
      !isAbsolute(target) && (isPaired ? invocations[index]?.moved === true : hasMoving);
    // An entry covers the word only when both spellings of it (see `scriptPathsOf`) name that same entry.
    const covered = (lookup: (spelling: { target: string }) => string | undefined) => {
      const asWritten = lookup({ target });

      return asWritten === lookup({ target: resolve(opts.cwd, target) }) ? asWritten : undefined;
    };
    const trusted = opts.trust;
    const listed =
      trusted === undefined || isFromUnknownFolder
        ? undefined
        : (covered((spelling) =>
            listedScriptOf({
              target: spelling.target,
              cwd: opts.cwd,
              root: trusted.root,
              scripts: trusted.scripts,
            }),
          ) ??
          (subcommand === undefined
            ? undefined
            : covered((spelling) =>
                ReadOnlyScripts.find({
                  target: spelling.target,
                  subcommand,
                  cwd: opts.cwd,
                  root: trusted.root,
                  entries,
                }),
              )));
    const trust =
      listed === undefined || opts.trust === undefined
        ? undefined
        : trustOf({ root: opts.trust.root, script: listed });

    if (trust?.state === TrustStates.TRUSTED) {
      continue;
    }

    for (const check of SCRIPT_CHECKS.filter((scriptCheck) =>
      sources.some((text) => scriptCheck.pattern.test(text)),
    )) {
      hits.push({
        rule: check.rule,
        message: `${target} looks like it is ${check.what}${trust === undefined ? '' : ` (listed in guard.writes.trustedScripts, but not trusted: ${trust.reason})`}`,
      });
    }
  }

  return hits;
};

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** The Bash command and cwd from the hook's JSON; `undefined` when it is not what Claude Code sends. */
export const parseHookCommand = (opts: { text: string }): IHookCommand | undefined => {
  let payload: unknown;

  try {
    payload = JSON.parse(opts.text);
  } catch (error) {
    console.error(
      `[parseHookCommand] unreadable hook input - letting the command through | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }

  const holder = { value: payload };

  if (!isRecord(holder)) {
    return undefined;
  }

  // The wire names are snake_case; they stay behind string-literal access here, at the boundary (V-C-14).
  const toolInput = { value: holder.value['tool_input'] };
  const command = isRecord(toolInput) ? toolInput.value['command'] : undefined;
  const cwd = holder.value['cwd'];

  return typeof command === 'string' && command !== ''
    ? { command, cwd: typeof cwd === 'string' ? cwd : undefined }
    : undefined;
};

export const buildGuardDecision = (opts: { hits: IWriteHit[] }) =>
  forHost({
    output: {
      hookSpecificOutput: {
        hookEventName: HookConstants.PRE_TOOL_USE,
        permissionDecision: HookConstants.GUARD_DECISION,
        permissionDecisionReason: [
          `This command looks like ${opts.hits.length === 1 ? 'an action' : 'actions'} the base rules reserve for a human:`,
          ...opts.hits.map((hit) => `  - ${hit.rule}: ${hit.message}`),
          '',
          'The rules reject "it is only dev", "it is only a test row" and "it is reversible".',
          'Produce the script, the SQL or the manifest and hand it over instead of running it.',
        ].join('\n'),
      },
    },
  });
