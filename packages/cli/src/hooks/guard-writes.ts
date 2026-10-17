import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { HookConstants } from './common/index.ts';
import type { IHookCommand, IWriteCheck, IWriteHit } from './common/index.ts';

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
  [...opts.command.matchAll(/\bbun\s+(?:run\s+)?(\S+\.ts)\b/g)].map(match => match[1]);

const readScript = (opts: { target: string; cwd: string }): string | undefined => {
  const path = isAbsolute(opts.target) ? opts.target : join(opts.cwd, opts.target);

  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

/** Every reason `command` looks like a write the base rules reserve for a human (V-W-02, V-W-03). */
export const inspectCommand = (opts: { command: string; cwd: string }): IWriteHit[] => {
  const hits: IWriteHit[] = COMMAND_CHECKS.filter(check => check.pattern.test(opts.command)).map(
    check => ({
      rule: check.rule,
      message: check.what,
    }),
  );

  for (const target of extractScriptTargets({ command: opts.command })) {
    const source = readScript({ target, cwd: opts.cwd });

    if (source === undefined) {
      continue;
    }

    for (const check of SCRIPT_CHECKS.filter(scriptCheck => scriptCheck.pattern.test(source))) {
      hits.push({ rule: check.rule, message: `${target} looks like it is ${check.what}` });
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

export const buildGuardDecision = (opts: { hits: IWriteHit[] }) => ({
  hookSpecificOutput: {
    hookEventName: HookConstants.PRE_TOOL_USE,
    permissionDecision: HookConstants.GUARD_DECISION,
    permissionDecisionReason: [
      `This command looks like ${opts.hits.length === 1 ? 'an action' : 'actions'} the base rules reserve for a human:`,
      ...opts.hits.map(hit => `  - ${hit.rule}: ${hit.message}`),
      '',
      'The rules reject "it is only dev", "it is only a test row" and "it is reversible".',
      'Produce the script, the SQL or the manifest and hand it over instead of running it.',
    ].join('\n'),
  },
});
