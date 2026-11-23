import { ghCall, gitCall } from './guard-git.ts';
import { ShellParser } from './shell.ts';

/** What a shell line did that the board should know: a commit, a pull request opened, a pull request merged. */
export class GitActivities {
  static readonly COMMIT = 'commit';
  static readonly PR_OPEN = 'pr-open';
  static readonly PR_MERGE = 'pr-merge';
}

export type TGitActivity = 'commit' | 'pr-open' | 'pr-merge';

/** Words after a subcommand that mean the line only reads or tries: nothing was committed, opened or merged. */
const READS = new Set(['--help', '-h', '--dry-run']);

/**
 * Which of the three the command line is, by the guards' own shell parser and call readers (`gitCall`, `ghCall`), so
 * `git -C dir commit`, `gh -R x pr create` and a line chained with `&&` read the same way as for the git guard. It
 * returns a class and never the command: the event hook logs a fixed label for it.
 */
export class GitActivity {
  static classify(opts: { command: string }): TGitActivity | undefined {
    const parsed = ShellParser.parseChecked({ command: opts.command });

    for (const command of parsed.commands) {
      const program = ShellParser.programOf({ command });
      const name = ShellParser.basenameOf({ word: program.name });

      if (name === 'git') {
        const call = gitCall({ args: program.args });

        if (call.sub === 'commit' && !call.rest.some((word) => READS.has(word))) {
          return GitActivities.COMMIT;
        }
      }

      if (name === 'gh' || name === 'glab') {
        const { group, action, rest } = ghCall({ args: program.args });
        const isRequest = name === 'gh' ? group === 'pr' : group === 'mr';

        if (isRequest && !rest.some((word) => READS.has(word))) {
          if (action === 'create' || action === 'new') {
            return GitActivities.PR_OPEN;
          }

          if (action === 'merge') {
            return GitActivities.PR_MERGE;
          }
        }
      }
    }

    return undefined;
  }
}
