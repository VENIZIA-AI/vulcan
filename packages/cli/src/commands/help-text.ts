import { CommandScopes } from './scopes.ts';
import type { IUsage } from './table.ts';

const WIDTH = 100;
const USAGE_INDENT = '  ';
/** The indent of a usage's further lines and of its description. */
const INDENT = '      ';

/** What each scope is for: the header above its commands. */
const HEADERS: Readonly<Record<string, string>> = {
  project: "this project's VULCAN setup",
  package: 'the apps and libraries of a monorepo',
  agent: 'the coding agents on this machine',
  config: 'the config file',
  check: 'checks that fail a commit or CI',
  migrate: 'moving packages between releases',
  flow: 'the pieces of work on the board',
  event: 'the agent event log',
  board: 'the page made from the log',
  page: 'one-off HTML pages',
  profile: 'how you like to work',
  okf: 'a shipped tool',
  atlas: 'a shipped tool',
};

/** The help as text: grouped by scope, every line within the width. */
export class HelpText {
  /** One scope: its header, then its usages in the order of its actions (those a handler keeps for itself first). */
  static scope(opts: { scope: string; usages: readonly IUsage[] }): string {
    const actions = CommandScopes.actionsOf({ scope: opts.scope });
    const rankOf = (usage: IUsage): number => actions.indexOf(usage.command.split(' ')[1]);
    const blocks = opts.usages
      .filter((usage) => usage.command.split(' ')[0] === opts.scope)
      .sort((left, right) => rankOf(left) - rankOf(right))
      .map((usage) => HelpText.block({ usage }));

    return `${opts.scope}: ${HEADERS[opts.scope] ?? ''}\n\n${blocks.join('\n')}`;
  }

  private static block(opts: { usage: IUsage }): string {
    const { command, args, text } = opts.usage;

    return [
      ...HelpText.wrap({
        words: [`vulcan ${command}`, ...HelpText.groupsOf({ args })],
        first: USAGE_INDENT,
        rest: INDENT,
      }),
      ...HelpText.wrap({ words: text.split(' '), first: INDENT, rest: INDENT }),
    ].join('\n');
  }

  /** The arguments as the pieces a line may break between: a bracketed group stays whole when it fits on a line. */
  private static groupsOf(opts: { args: string }): string[] {
    const groups: string[] = [];
    let open = 0;

    for (const word of opts.args.split(' ').filter((entry) => entry !== '')) {
      if (open > 0) {
        groups[groups.length - 1] += ` ${word}`;
      } else {
        groups.push(word);
      }

      open += (word.match(/[[(<]/g)?.length ?? 0) - (word.match(/[\])>]/g)?.length ?? 0);
    }

    return groups.flatMap((group) =>
      INDENT.length + group.length > WIDTH ? group.split(' ') : [group],
    );
  }

  private static wrap(opts: { words: string[]; first: string; rest: string }): string[] {
    const lines: string[] = [];
    let line = '';

    for (const word of opts.words) {
      const indent = lines.length === 0 ? opts.first : opts.rest;

      if (line !== '' && indent.length + line.length + 1 + word.length > WIDTH) {
        lines.push(`${indent}${line}`);
        line = word;
        continue;
      }

      line = line === '' ? word : `${line} ${word}`;
    }

    if (line !== '') {
      lines.push(`${lines.length === 0 ? opts.first : opts.rest}${line}`);
    }

    return lines;
  }
}
