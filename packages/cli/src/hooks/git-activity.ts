import { GitActivities } from '../events/common/index.ts';
import type { TGitActivity } from '../events/common/index.ts';
import { ghCall, gitCall } from './guard-git.ts';
import { ShellParser } from './shell.ts';
import { ShellPrograms } from './shell-programs.ts';

/** Words after a subcommand that mean the line only reads or tries: nothing was committed, opened or merged. */
const READS = new Set(['--help', '-h', '--dry-run']);

/** Options of `git` that point it at another repository than the folder the hook runs in. */
const ELSEWHERE = new Set(['-C', '--git-dir', '--work-tree']);

/** Options of `gh` and `glab` that name another repository. */
const REPOSITORY = new Set(['-R', '--repo']);

/** `gh pr merge --auto` and `glab mr merge --when-pipeline-succeeds` only ask for a merge later: nothing is merged yet. */
const MERGE_LATER = new Set([
  '--auto',
  '--auto-merge',
  '--when-pipeline-succeeds',
  '--disable-auto',
]);

/** What `GitActivity.describe` says of a line that commits, opens or merges. */
export interface IGitActivityDetail {
  activity: TGitActivity;
  /** The line works in another repository than the hook's folder: `git -C`, `--git-dir`, `--work-tree`, `gh -R`, or a `cd` in the line. */
  isElsewhere: boolean;
  /** A `git commit --amend`: it rewrites a commit and adds no new work. */
  isAmend: boolean;
}

export class GitActivity {
  /** Which of the three the command line is; see `describe`. */
  static classify(opts: { command: string }): TGitActivity | undefined {
    return GitActivity.describe(opts)?.activity;
  }

  /**
   * Which of the three the command line is, by the guards' own shell parser and call readers (`gitCall`, `ghCall`), so
   * `git -C dir commit`, `gh -R x pr create` and a line chained with `&&` read the same way as for the git guard, and
   * whether it works elsewhere or amends. It returns a class and never the command: the event hook logs a fixed label.
   */
  static describe(opts: { command: string }): IGitActivityDetail | undefined {
    const parsed = ShellParser.parseChecked({ command: opts.command });
    const hasCd = parsed.commands.some(
      (command) =>
        ShellPrograms.basenameOf({ word: ShellPrograms.programOf({ command }).name }) === 'cd',
    );

    for (const command of parsed.commands) {
      const program = ShellPrograms.programOf({ command });
      const name = ShellPrograms.basenameOf({ word: program.name });

      if (name === 'git') {
        const call = gitCall({ args: program.args });

        if (call.sub === 'commit' && !call.rest.some((word) => READS.has(word))) {
          return {
            activity: GitActivities.COMMIT,
            isElsewhere:
              hasCd ||
              program.args.some((word) => ELSEWHERE.has(word) || word.startsWith('--git-dir=')),
            isAmend: call.rest.includes('--amend'),
          };
        }
      }

      if (name === 'gh' || name === 'glab') {
        const { group, action, rest } = ghCall({ args: program.args });
        const isRequest = name === 'gh' ? group === 'pr' : group === 'mr';
        const isElsewhere =
          hasCd || program.args.some((word) => REPOSITORY.has(word) || word.startsWith('--repo='));

        if (isRequest && !rest.some((word) => READS.has(word))) {
          if (action === 'create' || action === 'new') {
            return { activity: GitActivities.PR_OPEN, isElsewhere, isAmend: false };
          }

          if (action === 'merge' && !rest.some((word) => MERGE_LATER.has(word))) {
            return { activity: GitActivities.PR_MERGE, isElsewhere, isAmend: false };
          }
        }
      }
    }

    return undefined;
  }
}
