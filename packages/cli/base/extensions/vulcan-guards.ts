// Written by `vulcan sync` for omp and pi; sync rewrites it, so change the guards, not this file.
//
// VULCAN's guards for an agent that takes an extension instead of Claude Code's hook commands. Before each
// tool call it runs the same guard scripts Claude Code runs (node_modules/@venizia/vulcan/base/hooks/*.ts),
// with a Claude-shaped event on stdin, and turns the answer into this agent's: `deny` blocks, `ask` asks
// the owner (and blocks when there is no UI to ask). A guard that cannot give an answer follows the same
// policy as the Claude wrappers: the safety guards block, the others ask, and a missing install blocks
// too - bar a bare `bun install` or `vulcan sync`, the way to repair it (guard-git only for a git or gh line).
// A guard that is gone from an installed package blocks, except guard-writes, which passes: there is nothing
// to run. A project that sets `guard.asks: 'deny'` has every ask answered as a block.
// Only node: modules are imported, so any host that loads TypeScript can load it.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  /** Whether the call is blocked when the package is installed and only this guard is gone from it. */
  isClosedWhenGone: boolean;
  /** The lines the guard covers when it is missing: a line that does not match passes. Every line when absent. */
  onlyLines?: RegExp;
}

interface IAnswer {
  kind: string;
  reason: string;
}

const PACKAGE_DIRECTORY = join('node_modules', '@venizia', 'vulcan');
const HOOKS_DIRECTORY = join(PACKAGE_DIRECTORY, 'base', 'hooks');
const TIMEOUT_MS = 30_000;
/** The commands that pass while the install is missing or out of step: they are how it is repaired (`bun install`, `vulcan sync`). */
const REPAIR =
  /^\s*(bun (install|i)( (--frozen-lockfile|--production|-p|--no-save|--ignore-scripts|--force|--verbose|--silent))*|bun node_modules\/\.bin\/vulcan sync( --?[a-z][a-z-]*( [\w./@-]+)?)*)\s*$/;
/** A command line that names git or gh as a word. */
const GIT_LINE = /(^|[^A-Za-z0-9_])(git|gh)([^A-Za-z0-9_]|$)/;
const MANIFEST_FILE = join('.agents', 'vulcan.manifest.json');
const HELD_ASK =
  'Every call that would need a human to confirm it is denied here (guard.asks: deny, VULCAN_GUARD_ASKS=deny, or a manifest that cannot be read). Nothing was run: hand this to the owner.';

/** The guards of `.claude/settings.json`, with the tools each covers and what each does when it cannot answer. */
const GUARDS: IGuard[] = [
  { name: 'guard-writes', tools: [Tools.BASH], onFailure: Failures.BLOCK, isClosedWhenGone: false },
  {
    name: 'guard-git',
    tools: [Tools.BASH],
    onFailure: Failures.ASK,
    isClosedWhenGone: true,
    onlyLines: GIT_LINE,
  },
  {
    name: 'guard-outside',
    tools: [Tools.BASH, Tools.WRITE, Tools.EDIT],
    onFailure: Failures.ASK,
    isClosedWhenGone: true,
  },
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

/**
 * Whether every ask is a deny in the project at `root`: the launch environment says `VULCAN_GUARD_ASKS=deny`, the manifest sets
 * `guard.asks` to `deny`, or the manifest exists and cannot be read. No manifest means asks stay asks.
 */
const isHeldIn = (opts: { root: string }): boolean => {
  if (process.env.VULCAN_GUARD_ASKS === Answers.DENY) {
    return true;
  }

  const file = join(opts.root, MANIFEST_FILE);

  if (!existsSync(file)) {
    return false;
  }

  try {
    const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const guard = isRecord(manifest) ? manifest.guard : undefined;

    return !isRecord(manifest) || (isRecord(guard) && guard.asks === Answers.DENY);
  } catch {
    return true;
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
    // The package is installed and only this guard is gone from it: guard-writes passes (nothing to run), the others block.
    if (existsSync(join(opts.root, PACKAGE_DIRECTORY, 'package.json'))) {
      return opts.guard.isClosedWhenGone
        ? {
            kind: Answers.MISSING,
            reason: `VULCAN guards unavailable: ${opts.guard.name} is not in the installed package; run bun node_modules/.bin/vulcan sync`,
          }
        : { kind: Answers.ALLOW, reason: '' };
    }

    return {
      kind: Answers.MISSING,
      reason: `VULCAN guards unavailable: ${opts.guard.name} is missing; finish bun install`,
    };
  }

  // bun reads `.env` and `bunfig.toml` from the working directory: a file an agent writes there (a `VULCAN_GUARDS=off`, a preload) must not reach a guard.
  const result = spawnSync('bun', ['--no-env-file', '--config=/dev/null', script], {
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

export class GuardVerdict {
  /**
   * What the guards say about one tool call: `deny` (blocked), `ask` (the owner decides; one reason holds every
   * guard that asked) or `allow`. Exported so a host that is not an extension (Antigravity's hook command) can
   * use the same policy.
   */
  static verdictOf(opts: {
    toolName: string;
    input: Record<string, unknown>;
    cwd: string;
  }): IVerdict {
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
        const command = String(opts.input.command);
        const isRepair = opts.toolName === Tools.BASH && REPAIR.test(command);
        const isCovered =
          guard.onlyLines === undefined ||
          (opts.toolName === Tools.BASH && guard.onlyLines.test(command));

        if (!isRepair && isCovered) {
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

    if (asks.length > 0 && isHeldIn({ root })) {
      return { kind: Verdicts.DENY, reason: `${asks.join('\n\n')}\n\n${HELD_ASK}` };
    }

    return asks.length > 0
      ? { kind: Verdicts.ASK, reason: asks.join('\n\n') }
      : { kind: Verdicts.ALLOW, reason: '' };
  }
}

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
    const verdict = GuardVerdict.verdictOf({
      toolName: event.toolName,
      input: event.input,
      cwd: context.cwd,
    });

    if (verdict.kind === Verdicts.DENY) {
      return { block: true, reason: verdict.reason };
    }

    return verdict.kind === Verdicts.ASK
      ? askOwner({ context, reason: verdict.reason })
      : undefined;
  });
}
