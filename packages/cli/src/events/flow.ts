import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { EventConstants } from './common/index.ts';

const GITDIR_LINE = /^gitdir:\s*(.+)$/m;
const HEAD_REF = /^ref:\s*refs\/heads\/(.+?)\s*$/m;
const BRANCH_FLOW = /(?:^|\/)(F-\d+)(?=-|\/|$)/;
/** Enough parents for a deep folder inside a project; the walk stops at the filesystem root anyway. */
const MAX_PARENTS = 40;

/** The flow a line of the log belongs to: `F-n`, from the writer, the first line of a message or the branch. */
export class EventFlow {
  static isValid(opts: { flow: string }): boolean {
    return EventConstants.FLOW_EXACT.test(opts.flow);
  }

  /** `Flow: F-n` in the first line of `text`. */
  static fromText(opts: { text: string }): string | undefined {
    const first = opts.text.split(/\r\n|\r|\n/).find((line) => line.trim() !== '') ?? '';

    return EventConstants.FLOW_LINE.exec(first)?.[1];
  }

  /** `F-n` as a whole segment of a branch name: `feature/F-12-events-log`. */
  static fromBranchName(opts: { branch: string }): string | undefined {
    return BRANCH_FLOW.exec(opts.branch)?.[1];
  }

  /**
   * The flow in the branch checked out at `cwd`. It reads `HEAD` itself, in the folder or in the folder a
   * linked worktree points to, because a hook cannot afford to start git. `undefined` when it cannot tell.
   */
  static fromBranch(opts: { cwd: string }): string | undefined {
    const branch = EventFlow.branchOf({ cwd: opts.cwd });

    return branch === undefined ? undefined : EventFlow.fromBranchName({ branch });
  }

  private static branchOf(opts: { cwd: string }): string | undefined {
    let directory = resolve(opts.cwd);

    for (let step = 0; step < MAX_PARENTS; step++) {
      const gitdir = EventFlow.gitDirOf({ directory });

      if (gitdir !== undefined) {
        return EventFlow.headOf({ gitdir });
      }

      const parent = dirname(directory);

      if (parent === directory) {
        return undefined;
      }

      directory = parent;
    }

    return undefined;
  }

  private static gitDirOf(opts: { directory: string }): string | undefined {
    const path = join(opts.directory, '.git');

    if (!existsSync(path)) {
      return undefined;
    }

    try {
      if (statSync(path).isDirectory()) {
        return path;
      }

      const target = GITDIR_LINE.exec(readFileSync(path, 'utf8'))?.[1]?.trim();

      return target === undefined
        ? undefined
        : isAbsolute(target)
          ? target
          : resolve(opts.directory, target);
    } catch {
      return undefined;
    }
  }

  private static headOf(opts: { gitdir: string }): string | undefined {
    try {
      return HEAD_REF.exec(readFileSync(join(opts.gitdir, 'HEAD'), 'utf8'))?.[1];
    } catch {
      return undefined;
    }
  }
}
