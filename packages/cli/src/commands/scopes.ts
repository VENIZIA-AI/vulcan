import { VulcanCommands } from '../common/index.ts';

/** One public command: `vulcan <scope> <action>`, run by the handler of `command` with `prefix` in front of the rest of the arguments. */
interface IScopedCommand {
  scope: string;
  action: string;
  command: string;
  prefix?: string[];
}

/** What an argv resolves to: the handler's own argv, or a refusal that says what to type. */
export type TScopeResolution =
  | { type: 'run'; argv: string[]; label: string }
  | { type: 'refused'; message: string; exit: number }
  | { type: 'forwarded'; argv: string[]; notice: string };

/** Scopes that pass everything after the scope to a shipped tool: `vulcan atlas mcp` runs `vulcan x atlas mcp`. */
const TOOL_SCOPES = new Set(['okf', 'atlas']);

/**
 * The public surface is `vulcan <scope> <action> <...args>`. The handlers keep the names they were written with; this table is the
 * only place that knows both, so the help, the router's argument checks and the pairs of an old form and its replacement come from it.
 */
export class CommandScopes {
  static readonly COMMANDS: IScopedCommand[] = [
    { scope: 'project', action: 'init', command: VulcanCommands.INIT },
    { scope: 'project', action: 'sync', command: VulcanCommands.SYNC },
    { scope: 'project', action: 'doctor', command: VulcanCommands.DOCTOR },
    { scope: 'project', action: 'upgrade', command: VulcanCommands.UPGRADE },
    { scope: 'project', action: 'clean', command: VulcanCommands.CLEAN },
    { scope: 'package', action: 'add', command: VulcanCommands.ADD },
    { scope: 'package', action: 'diff', command: VulcanCommands.PRESET, prefix: ['diff'] },
    { scope: 'agent', action: 'list', command: VulcanCommands.AGENTS, prefix: ['list'] },
    { scope: 'agent', action: 'add', command: VulcanCommands.AGENTS, prefix: ['add'] },
    { scope: 'agent', action: 'remove', command: VulcanCommands.AGENTS, prefix: ['remove'] },
    { scope: 'agent', action: 'setup', command: VulcanCommands.AGENTS, prefix: ['setup'] },
    {
      scope: 'config',
      action: 'effective',
      command: VulcanCommands.CONFIG,
      prefix: ['--effective'],
    },
    { scope: 'config', action: 'diff', command: VulcanCommands.CONFIG, prefix: ['--diff'] },
    { scope: 'config', action: 'format', command: VulcanCommands.CONFIG, prefix: ['format'] },
    { scope: 'check', action: 'layout', command: VulcanCommands.LAYOUT, prefix: ['check'] },
    { scope: 'check', action: 'commit', command: VulcanCommands.COMMIT_CHECK },
    { scope: 'check', action: 'runners', command: VulcanCommands.RUNNERS, prefix: ['check'] },
    { scope: 'check', action: 'changelog', command: VulcanCommands.CHANGELOG, prefix: ['check'] },
    { scope: 'migrate', action: 'notes', command: VulcanCommands.CHANGELOG, prefix: ['notes'] },
    {
      scope: 'flow',
      action: 'add',
      command: VulcanCommands.EVENT,
      prefix: ['add', '--kind', 'flow'],
    },
    { scope: 'flow', action: 'step', command: VulcanCommands.EVENT, prefix: ['step'] },
    { scope: 'event', action: 'add', command: VulcanCommands.EVENT, prefix: ['add'] },
    // `event step` stays beside `flow step`: it is the same line of the log, and `event add --kind flow` works as `flow add`.
    { scope: 'event', action: 'step', command: VulcanCommands.EVENT, prefix: ['step'] },
    { scope: 'event', action: 'tail', command: VulcanCommands.EVENT, prefix: ['tail'] },
    { scope: 'board', action: 'show', command: VulcanCommands.BOARD },
    { scope: 'board', action: 'serve', command: VulcanCommands.BOARD, prefix: ['serve'] },
    { scope: 'page', action: 'new', command: VulcanCommands.VISUALIZE },
    { scope: 'page', action: 'schema', command: VulcanCommands.VISUALIZE, prefix: ['--schema'] },
  ];

  /** Scopes whose actions the handlers already take as their own first argument: `profile` and `migrate` keep their handlers whole. */
  static readonly NATIVE_SCOPES = new Set([VulcanCommands.PROFILE, VulcanCommands.MIGRATE]);

  /**
   * The old top-level names and what replaces them. `forwards` marks a name that still runs for one release, with a notice: a
   * machine-installed call site (the `prepare` script, the commit-msg hook, the `.mcp.json` entry of `vulcan x atlas mcp`) runs it before anyone has run `project sync` once.
   */
  static readonly RETIRED: Record<string, { replacement: string; forwards?: true }> = {
    init: { replacement: 'project init' },
    sync: { replacement: 'project sync', forwards: true },
    doctor: { replacement: 'project doctor' },
    upgrade: { replacement: 'project upgrade' },
    clean: { replacement: 'project clean' },
    add: { replacement: 'package add' },
    preset: { replacement: 'package diff' },
    agents: { replacement: 'agent <list|add|remove|setup>' },
    'commit-check': { replacement: 'check commit', forwards: true },
    runners: { replacement: 'check runners' },
    layout: { replacement: 'check layout' },
    changelog: { replacement: 'check changelog (or migrate notes)' },
    visualize: { replacement: 'page new (or page schema)' },
    x: { replacement: 'okf ... or atlas ...', forwards: true },
  };

  /**
   * The argv of a public command, `[scope, action]`, for a place that starts the installed `vulcan` as a child: it takes the words from this
   * table, so a command that moves cannot leave a spawn behind that the router answers with a notice or a refusal. A pair the
   * table does not know throws; so does a pair of `profile` or `migrate plan|apply`, which keep their handlers' own words and are not in the table.
   */
  static argvOf(opts: { scope: string; action: string }): string[] {
    const known =
      TOOL_SCOPES.has(opts.scope) ||
      CommandScopes.COMMANDS.some(
        (entry) => entry.scope === opts.scope && entry.action === opts.action,
      );

    if (!known) {
      throw new Error(`vulcan: no command '${opts.scope} ${opts.action}' in the scope table`);
    }

    return [opts.scope, opts.action];
  }

  static scopes(): string[] {
    return [
      ...new Set([
        ...CommandScopes.COMMANDS.map((entry) => entry.scope),
        ...CommandScopes.NATIVE_SCOPES,
        ...TOOL_SCOPES,
      ]),
    ];
  }

  static actionsOf(opts: { scope: string }): string[] {
    return CommandScopes.COMMANDS.filter((entry) => entry.scope === opts.scope).map(
      (entry) => entry.action,
    );
  }

  /** Where an argv goes: to a handler (in its own words), to a refusal that names the form to type, or forwarded with a notice. */
  static resolve(opts: { argv: string[] }): TScopeResolution | undefined {
    const [first, second, ...rest] = opts.argv;

    if (first === undefined) {
      return undefined;
    }

    if (TOOL_SCOPES.has(first)) {
      return {
        type: 'run',
        label: first,
        argv: [VulcanCommands.X, first, ...(second === undefined ? [] : [second, ...rest])],
      };
    }

    // `vulcan agent` alone is `vulcan agent list`, as `vulcan agents` was.
    if (first === 'agent' && second === undefined) {
      return { type: 'run', label: 'agent list', argv: [VulcanCommands.AGENTS] };
    }

    // `vulcan event` and `vulcan flow` alone print the usage of the event handler, as `vulcan event` did.
    if ((first === 'event' || first === 'flow') && second === undefined) {
      return { type: 'run', label: first, argv: [VulcanCommands.EVENT] };
    }

    const actions = CommandScopes.actionsOf({ scope: first });

    if (actions.length > 0) {
      const found = CommandScopes.COMMANDS.find(
        (entry) => entry.scope === first && entry.action === second,
      );

      // `migrate plan` and `migrate apply` are the handler's own words.
      if (found === undefined && CommandScopes.NATIVE_SCOPES.has(first)) {
        return undefined;
      }

      if (found === undefined) {
        return {
          type: 'refused',
          exit: 2,
          message: `vulcan ${first}: ${second === undefined ? 'needs an action' : `unknown action '${second}'`} - one of: ${actions.join(', ')}`,
        };
      }

      return {
        type: 'run',
        label: `${found.scope} ${found.action}`,
        argv: [found.command, ...(found.prefix ?? []), ...rest],
      };
    }

    const retired = CommandScopes.RETIRED[first];

    if (retired !== undefined && !CommandScopes.scopes().includes(first)) {
      const notice = `vulcan ${first} is now vulcan ${retired.replacement}`;

      return retired.forwards === true
        ? { type: 'forwarded', argv: opts.argv, notice }
        : { type: 'refused', exit: 2, message: notice };
    }

    return undefined;
  }
}
