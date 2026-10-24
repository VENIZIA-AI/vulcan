import { createHash } from 'node:crypto';
import { parseShell, programOf } from '../hooks/shell.ts';
import { SignalConstants, WatchedKinds } from './constants.ts';

const LOCAL_URL = /^https?:\/\/(?:localhost|127\.|0\.0\.0\.0|\[::1\])/;
const GATE_SCRIPTS = new Set(['test', 'lint', 'build', 'typecheck', 'check']);
const GATE_TOOLS = new Set(['tsc', 'vitest', 'jest', 'pytest', 'eslint', 'oxlint']);
const GATE_MAKE_TARGET = /^(?:test|lint|build|check|typecheck|docs|smoke)(?:[-:\w]*)$/;
const READ_VIEWS = new Set(['view', 'list', 'status', 'checks', 'watch']);
const SKILL_FILE =
  /(?:^|\/)(?:\.agents\/skills|\.claude\/skills|packages\/[^/]+\/base\/skills)\/([^/]+)\/(?:SKILL\.md|references\/.+|evals\/.+)$/;
const RULES_FILE = /(?:^|\/)(?:\.agents\/rules\.md|packages\/[^/]+\/base\/rules\.md)$/;
const SCRATCH = /(?:^|\/)\.agents\/local\//;

/** The simple commands of a line as program and arguments; a line that cannot be parsed has none. */
const programsOf = (opts: { command: string }): { name: string; args: string[] }[] => {
  try {
    return parseShell({ command: opts.command }).map((simple) => {
      const { name, args } = programOf({ command: simple });

      return { name, args };
    });
  } catch {
    return [];
  }
};

/** The tool input as a short stable key: the same call twice has the same key. */
export const callKeyOf = (opts: { tool: string; input: unknown }): string =>
  `${opts.tool}:${createHash('sha1')
    .update(JSON.stringify(opts.input ?? null))
    .digest('hex')
    .slice(0, SignalConstants.EVENT_KEY_LENGTH)}`;

const isProbeProgram = (opts: { name: string; args: string[] }): boolean => {
  const { name, args } = opts;

  if (name === 'npm') {
    return ['view', 'info', 'show', 'dist-tag'].includes(args[0] ?? '');
  }

  if (name === 'git') {
    return args[0] === 'ls-remote';
  }

  if (name === 'gh') {
    if (args[0] === 'api') {
      return !args.some((arg) => /^(?:-X|--method|-f|-F|--field|--raw-field|--input)$/.test(arg));
    }

    return args.some((arg) => READ_VIEWS.has(arg)) && !args.includes('create');
  }

  if (name === 'curl') {
    const url = args.find((arg) => /^https?:\/\//.test(arg));

    return (
      url !== undefined &&
      !LOCAL_URL.test(url) &&
      !args.some((arg) => /^(?:-X|--request|-d|--data.*|-F|--form|-T)$/.test(arg))
    );
  }

  return false;
};

/** A command that asks public state: the registry, the forge, a remote, an outside URL; not a write. */
export const isPublicProbe = (opts: { command: string }): boolean =>
  programsOf({ command: opts.command }).some((program) => isProbeProgram(program));

const isGateProgram = (opts: { name: string; args: string[] }): boolean => {
  const { name, args } = opts;
  const first = args.find((arg) => !arg.startsWith('-')) ?? '';

  if (name === 'bun') {
    return (
      first === 'test' ||
      (first === 'run' && GATE_SCRIPTS.has(args[args.indexOf('run') + 1] ?? '')) ||
      (first === 'x' && args.includes('vulcan') && args.includes('doctor'))
    );
  }

  if (name === 'bunx' || name === 'npx') {
    return GATE_TOOLS.has(first);
  }

  if (name === 'make') {
    return args.some((arg) => !arg.startsWith('-') && GATE_MAKE_TARGET.test(arg));
  }

  if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
    return (
      GATE_SCRIPTS.has(first) ||
      (first === 'run' && GATE_SCRIPTS.has(args[args.indexOf('run') + 1] ?? ''))
    );
  }

  if (name === 'cargo' || name === 'go') {
    return first === 'test';
  }

  if (name === 'vulcan') {
    return first === 'doctor';
  }

  return GATE_TOOLS.has(name);
};

/** The gates a command line runs (tests, lint, build, the project's own gates), each as a short name. */
export const gatesOf = (opts: { command: string }): string[] =>
  programsOf({ command: opts.command })
    .filter((program) => isGateProgram(program))
    .map((program) =>
      [program.name, ...program.args].join(' ').slice(0, SignalConstants.GATE_KEY_LENGTH),
    );

/** What an edited file is for the nudge: a skill (with its name), a rules file, or neither. */
export const watchedFileOf = (opts: {
  path: string;
}): { kind: string; name: string } | undefined => {
  if (SCRATCH.test(opts.path)) {
    return undefined;
  }

  const skill = SKILL_FILE.exec(opts.path)?.[1];

  if (skill !== undefined) {
    return { kind: WatchedKinds.SKILL, name: skill };
  }

  return RULES_FILE.test(opts.path) ? { kind: WatchedKinds.RULES, name: opts.path } : undefined;
};
