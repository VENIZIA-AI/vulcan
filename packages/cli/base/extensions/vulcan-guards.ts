// Written by `vulcan sync` for omp and pi; sync rewrites it, so change the guards, not this file.
//
// VULCAN's guards for an agent that takes an extension instead of Claude Code's hook commands. Before each
// tool call it runs the same guard scripts Claude Code runs (node_modules/@venizia/vulcan/base/hooks/*.ts),
// with a Claude-shaped event on stdin, and turns the answer into this agent's: `deny` blocks, `ask` asks
// the owner (and blocks when there is no UI to ask). A guard that cannot give an answer follows the same
// policy as the Claude wrappers: the safety guards block, the others ask, and a missing install passes
// except for the safety guards, which block - bar a bare `bun install`, the way to repair it.
// Only node: modules are imported, so any host that loads TypeScript can load it.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

class Tools {
  static readonly BASH = 'bash';
  static readonly WRITE = 'write';
  static readonly EDIT = 'edit';
}

/** What a guard does when it cannot answer: a crash, a timeout, or no install to run. */
class Failures {
  static readonly BLOCK = 'block';
  static readonly ASK = 'ask';
}

class Answers {
  static readonly ALLOW = 'allow';
  static readonly ASK = 'ask';
  static readonly DENY = 'deny';
  static readonly FAILED = 'failed';
  static readonly MISSING = 'missing';
}

interface IToolEvent {
  toolName: string;
  input: Record<string, unknown>;
}

interface IToolContext {
  cwd: string;
  hasUI: boolean;
  ui: { confirm: (title: string, message: string) => Promise<boolean> };
}

interface IBlock {
  block: boolean;
  reason: string;
}

interface IHost {
  on: (
    event: 'tool_call',
    handler: (event: IToolEvent, context: IToolContext) => Promise<IBlock | undefined>,
  ) => unknown;
}

interface IGuard {
  name: string;
  tools: string[];
  onFailure: string;
}

interface IAnswer {
  kind: string;
  reason: string;
}

const HOOKS_DIRECTORY = join('node_modules', '@venizia', 'vulcan', 'base', 'hooks');
const TIMEOUT_MS = 30_000;
/** The one command that passes while the install is missing: it is how the install is repaired. */
const BUN_INSTALL =
  /^\s*bun (install|i)( (--frozen-lockfile|--production|-p|--no-save|--ignore-scripts|--force|--verbose|--silent))*\s*$/;

/** The guards of `.claude/settings.json`, with the tools each covers and what each does when it cannot answer. */
const GUARDS: IGuard[] = [
  { name: 'guard-writes', tools: [Tools.BASH], onFailure: Failures.BLOCK },
  {
    name: 'guard-manifest',
    tools: [Tools.BASH, Tools.WRITE, Tools.EDIT],
    onFailure: Failures.BLOCK,
  },
  { name: 'guard-package', tools: [Tools.WRITE], onFailure: Failures.BLOCK },
  { name: 'guard-git', tools: [Tools.BASH], onFailure: Failures.ASK },
  { name: 'guard-outside', tools: [Tools.BASH, Tools.WRITE, Tools.EDIT], onFailure: Failures.ASK },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The project root: the nearest folder at or above `cwd` that has the package installed, else `cwd`. */
const rootOf = (opts: { cwd: string }): string => {
  let directory = opts.cwd;

  for (;;) {
    if (existsSync(join(directory, HOOKS_DIRECTORY))) {
      return directory;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return opts.cwd;
    }

    directory = parent;
  }
};

/** The event Claude Code sends: snake_case keys on the wire, written through string-literal keys. */
const wireEventOf = (opts: {
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
}): Record<string, unknown> =>
  Object.fromEntries([
    ['tool_name', opts.tool],
    ['tool_input', opts.input],
    ['cwd', opts.cwd],
  ]);

/** The event as Claude Code would send it, or `undefined` for a tool no guard covers. */
const claudeEventOf = (opts: {
  event: IToolEvent;
  root: string;
}): Record<string, unknown> | undefined => {
  const { event, root } = opts;
  const path = event.input.path ?? event.input.file_path;

  if (event.toolName === Tools.BASH && typeof event.input.command === 'string') {
    return wireEventOf({
      tool: 'Bash',
      input: Object.fromEntries([['command', event.input.command]]),
      cwd: root,
    });
  }

  if (event.toolName === Tools.WRITE && typeof path === 'string') {
    return wireEventOf({
      tool: 'Write',
      input: Object.fromEntries([
        ['file_path', path],
        ['content', event.input.content],
      ]),
      cwd: root,
    });
  }

  if (event.toolName === Tools.EDIT && typeof path === 'string') {
    return wireEventOf({
      tool: 'Edit',
      input: Object.fromEntries([['file_path', path]]),
      cwd: root,
    });
  }

  return undefined;
};

/** The decision of a guard's stdout (`hookSpecificOutput.permissionDecision`), or allow when it printed none. */
const answerOf = (opts: { stdout: string }): IAnswer => {
  if (opts.stdout.trim() === '') {
    return { kind: Answers.ALLOW, reason: '' };
  }

  try {
    const parsed: unknown = JSON.parse(opts.stdout);
    const output = isRecord(parsed) ? parsed.hookSpecificOutput : undefined;
    const decision = isRecord(output) ? output.permissionDecision : undefined;
    const reason = isRecord(output) ? output.permissionDecisionReason : undefined;

    if (decision === Answers.DENY || decision === Answers.ASK) {
      return { kind: decision, reason: typeof reason === 'string' ? reason : '' };
    }
  } catch {
    return { kind: Answers.FAILED, reason: 'the guard printed something that is not JSON' };
  }

  return { kind: Answers.ALLOW, reason: '' };
};

const runGuard = (opts: {
  guard: IGuard;
  root: string;
  claudeEvent: Record<string, unknown>;
}): IAnswer => {
  const script = join(opts.root, HOOKS_DIRECTORY, `${opts.guard.name}.ts`);

  if (!existsSync(script)) {
    return { kind: Answers.MISSING, reason: `${opts.guard.name} is missing: run bun install` };
  }

  const result = spawnSync('bun', [script], {
    input: JSON.stringify(opts.claudeEvent),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root },
  });

  if (result.error !== undefined && 'code' in result.error && result.error.code === 'ENOENT') {
    return { kind: Answers.MISSING, reason: 'bun is not on PATH: put bun on PATH' };
  }

  if (result.error !== undefined || result.status !== 0) {
    const why = result.error?.message ?? result.stderr.trim().split('\n').pop() ?? '';

    return { kind: Answers.FAILED, reason: `${opts.guard.name} crashed or timed out: ${why}` };
  }

  return answerOf({ stdout: result.stdout });
};

class Verdicts {
  static readonly ALLOW = 'allow';
  static readonly ASK = 'ask';
  static readonly DENY = 'deny';
}

export interface IVerdict {
  kind: string;
  reason: string;
}

/**
 * What the guards say about one tool call: `deny` (blocked), `ask` (the owner decides; one reason holds every
 * guard that asked) or `allow`. Exported so a host that is not an extension (Antigravity's hook command) can
 * use the same policy.
 */
export const verdictOf = (opts: {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
}): IVerdict => {
  const root = rootOf({ cwd: opts.cwd });
  const claudeEvent = claudeEventOf({ event: opts, root });
  const asks: string[] = [];

  if (claudeEvent === undefined) {
    return { kind: Verdicts.ALLOW, reason: '' };
  }

  for (const guard of GUARDS.filter((item) => item.tools.includes(opts.toolName))) {
    const answer = runGuard({ guard, root, claudeEvent });

    if (answer.kind === Answers.DENY) {
      return { kind: Verdicts.DENY, reason: answer.reason };
    }

    if (answer.kind === Answers.ASK) {
      asks.push(answer.reason);
    }

    if (answer.kind === Answers.MISSING) {
      const isRepair = opts.toolName === Tools.BASH && BUN_INSTALL.test(String(opts.input.command));

      if (guard.onFailure === Failures.BLOCK && !isRepair) {
        return { kind: Verdicts.DENY, reason: answer.reason };
      }
    }

    if (answer.kind === Answers.FAILED) {
      if (guard.onFailure === Failures.BLOCK) {
        return { kind: Verdicts.DENY, reason: answer.reason };
      }

      asks.push(answer.reason);
    }
  }

  return asks.length > 0
    ? { kind: Verdicts.ASK, reason: asks.join('\n\n') }
    : { kind: Verdicts.ALLOW, reason: '' };
};

/** Asks the owner when there is a UI to ask; without one the call is blocked, never let through. */
const askOwner = async (opts: {
  context: IToolContext;
  reason: string;
}): Promise<IBlock | undefined> => {
  if (!opts.context.hasUI) {
    return { block: true, reason: `${opts.reason}\n(no UI to confirm in: hand this to the owner)` };
  }

  const confirmed = await opts.context.ui.confirm('VULCAN guard', opts.reason);

  return confirmed ? undefined : { block: true, reason: 'declined by the owner' };
};

export default function vulcanGuards(host: IHost): void {
  host.on('tool_call', async (event, context) => {
    const verdict = verdictOf({ toolName: event.toolName, input: event.input, cwd: context.cwd });

    if (verdict.kind === Verdicts.DENY) {
      return { block: true, reason: verdict.reason };
    }

    return verdict.kind === Verdicts.ASK
      ? askOwner({ context, reason: verdict.reason })
      : undefined;
  });
}
