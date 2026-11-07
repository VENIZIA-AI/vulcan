import { HookConstants } from './common/index.ts';
import type { IHookCommand, IWriteCheck, IWriteHit } from './common/index.ts';
import { CommandView } from './command-view.ts';
import type { ICommandView } from './command-view.ts';
import { HookDecision } from './decision.ts';
import type { IProjectCommandCheck } from './project-guards.ts';
import { ScriptRunners } from './script-runners.ts';
import { WriteCommands } from './write-commands.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

interface IInspectOptions {
  command: string;
  /** The project's own commands (`guard.writes.commands`), checked beside the fixed list. */
  extra?: IProjectCommandCheck[];
}

export class WriteGuard {
  /**
   * Every reason `command` looks like a write the base rules reserve for a human (V-W-02, V-W-03): a command of
   * the table (`WriteCommands`) or of the project's own list, in each simple command the shell parser finds, and
   * what a database client is given that the line does not show.
   */
  static inspectCommand(opts: IInspectOptions): IWriteHit[] {
    // The patterns run on what the command runs, not on its text: a heredoc written to a file, the pattern
    // of an `rg` and a commit message are data.
    const view = CommandView.viewOf({ command: opts.command, withMessages: true });
    const hits: IWriteHit[] = [
      ...WriteGuard.commandChecksOf({ view, extra: opts.extra }).map((check) => ({
        rule: check.rule,
        message: check.what,
      })),
      ...view.commands.flatMap((command) => WriteCommands.inspectClient({ command })),
    ];
    const keys = new Set<string>();

    return hits.filter((hit) => {
      const key = `${hit.rule}\n${hit.message}`;

      if (keys.has(key)) {
        return false;
      }

      keys.add(key);

      return true;
    });
  }

  /**
   * The table's checks that match what a command line runs, and the project's own patterns. A check of the
   * table does not apply to a call of its program that changes nothing (`--help`, `--dry-run`, `curl -G`); a
   * whole line that pipes into a runner (no command behind it) always counts.
   */
  private static commandChecksOf(opts: {
    view: ICommandView;
    extra: IProjectCommandCheck[] | undefined;
  }): IWriteCheck[] {
    const { texts, sources } = opts.view;
    const fixed = WriteCommands.CHECKS.filter((check) =>
      texts.some((text, index) => {
        const command = sources[index];

        if (command === undefined) {
          return check.pattern.test(text);
        }

        const { program, args } = WriteGuard.callOf({ command });
        const { script } = ScriptRunners.callOf({ program, args });
        // `python manage.py migrate --plan`: the script is the program the row names.
        const named = script === undefined ? program : ShellParser.basenameOf({ word: script });

        return (
          WriteCommands.isLive({ check, program, args }) &&
          WriteCommands.isLive({ check, program: named, args }) &&
          check.pattern.test(text)
        );
      }),
    );
    const project = (opts.extra ?? [])
      .map((check) => ({
        rule: check.rule,
        what: `${check.what} (this project's pattern)`,
        pattern: check.pattern,
      }))
      .filter((check) => texts.some((text) => check.pattern.test(text)));

    return [...fixed, ...project];
  }

  /** The program a simple command runs, past wrappers (`sudo`, `env`) and launchers (`npx tsx`, `uv run`). */
  private static callOf(opts: { command: ISimpleCommand }): { program: string; args: string[] } {
    const launched = ScriptRunners.launchedOf(ShellParser.programOf({ command: opts.command }));

    return { program: ShellParser.basenameOf({ word: launched.name }), args: launched.args };
  }

  /** The Bash command and cwd from the hook's JSON; `undefined` when it is not what Claude Code sends. */
  static parseHookCommand(opts: { text: string }): IHookCommand | undefined {
    let payload: unknown;

    try {
      payload = JSON.parse(opts.text);
    } catch (error) {
      console.error(
        `[WriteGuard.parseHookCommand] unreadable hook input | ${error instanceof Error ? error.message : String(error)}`,
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
  }

  /** The hits the reason lists; a line of many commands can find dozens. */
  private static readonly MAX_LISTED_HITS = 20;

  static buildDecision(opts: { hits: IWriteHit[] }) {
    const listed = opts.hits.slice(0, WriteGuard.MAX_LISTED_HITS);
    const unlisted = opts.hits.length - listed.length;

    return HookDecision.forHost({
      output: {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          permissionDecision: HookConstants.GUARD_DECISION,
          permissionDecisionReason: [
            `This command looks like ${opts.hits.length === 1 ? 'an action' : 'actions'} the base rules reserve for a human:`,
            ...listed.map((hit) => `  - ${hit.rule}: ${hit.message}`),
            ...(unlisted > 0 ? [`  - and ${unlisted} more`] : []),
            '',
            'The rules reject "it is only dev", "it is only a test row" and "it is reversible".',
            'Produce the script, the SQL or the manifest and hand it over instead of running it.',
          ].join('\n'),
        },
      },
    });
  }
}
