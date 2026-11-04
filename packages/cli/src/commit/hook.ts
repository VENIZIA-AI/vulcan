import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { TResolvedConfig } from '../config/index.ts';
import type { ISyncAction } from '../sync/common/index.ts';
import { SyncStatuses } from '../sync/common/index.ts';
import { AgentSignaturePolicies, CommitHookStates } from './common/index.ts';
import type { ICommitHookStatus } from './common/index.ts';

const HOOK_NAME = 'commit-msg';
const MARKER = '# vulcan:commit-msg';
/** The marker line, then the folder of the project that wrote it in brackets; a hook of an earlier release has no brackets. */
const OWNER = /^# vulcan:commit-msg(?: \[([^\]]*)\])?/;
const CALL = /vulcan\s+commit-check/;
const COMMAND = 'bun x --no-install vulcan commit-check "$1"';

const git = (opts: { root: string; args: string[] }): string | undefined => {
  try {
    const result = Bun.spawnSync(['git', ...opts.args], {
      cwd: opts.root,
      stdout: 'pipe',
      stderr: 'ignore',
    });

    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
  } catch {
    return undefined;
  }
};

export class CommitHook {
  static isWanted(opts: { config: TResolvedConfig }): boolean {
    const { agent, subject } = opts.config.commit.message;

    return agent.signature === AgentSignaturePolicies.DENY || subject !== undefined;
  }

  /**
   * The hook file: a POSIX shell script that hands the message to `vulcan commit-check` from the
   * project folder. A commit goes through, with a note on stderr, when bun is not installed, no
   * `node_modules/@venizia/vulcan` is found from the project folder up to the git top level, or the installed vulcan has
   * no `commit-check` command (an older branch).
   */
  static template(opts: { prefix: string }): string {
    const folder = CommitHook.folderOf({ prefix: opts.prefix });
    const enter = folder === '' ? '' : `cd ${CommitHook.quote({ text: folder })} || exit 0\n`;

    return `#!/bin/sh
${MARKER} [${folder}] - written by vulcan sync from commit.message in .configs/vulcan.config.mts; do not edit
message="$1"
case "$message" in /*) ;; *) message="$PWD/$message" ;; esac
top="$(git rev-parse --show-toplevel)"
cd "$top" || exit 0
${enter}if ! command -v bun >/dev/null 2>&1; then
  echo "vulcan: the commit-msg hook is skipped - bun is not installed" >&2
  exit 0
fi
dir="$PWD"
while [ ! -d "$dir/node_modules/@venizia/vulcan" ]; do
  if [ "$dir" = "$top" ] || [ "$dir" = "/" ]; then
    echo "vulcan: the commit-msg hook is skipped - run bun install" >&2
    exit 0
  fi
  dir="$(dirname "$dir")"
done
output="$(${COMMAND.replace('"$1"', '"$message"')} 2>&1)"
status=$?
if [ "$status" -eq 1 ] && printf '%s\n' "$output" | grep -q "^vulcan: unknown command 'commit-check'"; then
  echo "vulcan: the commit-msg hook is skipped - the installed vulcan has no commit-check command" >&2
  exit 0
fi
[ -z "$output" ] || printf '%s\n' "$output" >&2
exit "$status"
`;
  }

  /** The project folder inside the repository, without the trailing slash; empty for the top level. */
  private static folderOf(opts: { prefix: string }): string {
    return opts.prefix.replace(/\/$/, '');
  }

  /**
   * The project folder a hook of ours was written for (empty: the repository's top level), or `undefined` when
   * the file is not ours. A hook of an earlier release carries no folder and is the top level's: it is the only
   * kind there was, and a project below the top level that wrote one is not told apart from it.
   */
  static ownerOf(opts: { text: string }): string | undefined {
    const matched = OWNER.exec(opts.text.split('\n')[1] ?? '');

    return matched === null ? undefined : (matched[1] ?? '');
  }

  private static quote(opts: { text: string }): string {
    return `'${opts.text.replaceAll("'", "'\\''")}'`;
  }

  /** A project that sets `core.hooksPath` owns its hooks: this only reads them. */
  static stateOf(opts: { root: string; config: TResolvedConfig }): ICommitHookStatus {
    const location = git({
      root: opts.root,
      args: ['rev-parse', '--git-path', `hooks/${HOOK_NAME}`],
    });
    const prefix = git({ root: opts.root, args: ['rev-parse', '--show-prefix'] });
    const isWanted = CommitHook.isWanted({ config: opts.config });

    if (location === undefined || location === '' || prefix === undefined) {
      return { state: isWanted ? CommitHookStates.NOT_GIT : CommitHookStates.OFF, path: '' };
    }

    const path = resolve(opts.root, location);
    const hooksPath = git({ root: opts.root, args: ['config', '--get', 'core.hooksPath'] });
    const entry = lstatSync(path, { throwIfNoEntry: false });
    const text = entry?.isFile() === true ? readFileSync(path, 'utf8') : undefined;
    const folder = CommitHook.folderOf({ prefix });
    const owner = text === undefined ? undefined : CommitHook.ownerOf({ text });
    // Ours is a hook this project wrote. One another project of the repository wrote is neither removed nor replaced.
    const isOurs = hooksPath === undefined && owner === folder;
    const isOtherProjects = hooksPath === undefined && owner !== undefined && owner !== folder;

    if (!isWanted) {
      return { state: isOurs ? CommitHookStates.LEFTOVER : CommitHookStates.OFF, path };
    }

    const addLine = `add '${COMMAND}' to its ${HOOK_NAME} hook`;

    if (hooksPath !== undefined) {
      return text !== undefined && CALL.test(text)
        ? { state: CommitHookStates.WIRED, path }
        : {
            state: CommitHookStates.UNWIRED,
            path,
            note: `core.hooksPath is ${hooksPath}: ${addLine}`,
          };
    }

    if (entry === undefined) {
      return { state: CommitHookStates.MISSING, path };
    }

    if (text === undefined) {
      return {
        state: CommitHookStates.UNWIRED,
        path,
        note: `a symbolic link or folder, not touched: ${addLine}`,
      };
    }

    if (isOtherProjects) {
      return {
        state: CommitHookStates.UNWIRED,
        path,
        note: `the hook belongs to ${owner === '' ? 'the project at the top of the repository' : `the project in ${owner}`}, not touched: a repository has one ${HOOK_NAME} hook`,
      };
    }

    if (isOurs) {
      const isCurrent = text === CommitHook.template({ prefix }) && (entry.mode & 0o111) !== 0;

      return { state: isCurrent ? CommitHookStates.WIRED : CommitHookStates.STALE, path };
    }

    return CALL.test(text)
      ? { state: CommitHookStates.WIRED, path }
      : {
          state: CommitHookStates.UNWIRED,
          path,
          note: `a hook of yours is there, not touched: ${addLine}`,
        };
  }

  static write(opts: { path: string; prefix: string }): void {
    mkdirSync(dirname(opts.path), { recursive: true });
    writeFileSync(opts.path, CommitHook.template({ prefix: opts.prefix }));
    chmodSync(opts.path, 0o755);
  }
}

export class CommitHookPlan {
  static plan(opts: { root: string; config: TResolvedConfig }): ISyncAction[] {
    const status = CommitHook.stateOf(opts);
    const prefix = git({ root: opts.root, args: ['rev-parse', '--show-prefix'] }) ?? '';
    const { path } = status;
    const write = (): void => CommitHook.write({ path, prefix });

    switch (status.state) {
      case CommitHookStates.MISSING: {
        return [{ path, status: SyncStatuses.CREATED, apply: write }];
      }

      case CommitHookStates.STALE: {
        return [{ path, status: SyncStatuses.REPLACED, apply: write }];
      }

      case CommitHookStates.WIRED: {
        return [{ path, status: SyncStatuses.UNCHANGED, apply: () => {} }];
      }

      case CommitHookStates.UNWIRED: {
        return [{ path, status: SyncStatuses.SKIPPED, note: status.note, apply: () => {} }];
      }

      case CommitHookStates.LEFTOVER: {
        return [
          {
            path,
            status: SyncStatuses.REMOVED,
            note: 'no commit check is turned on',
            apply: () => rmSync(path),
          },
        ];
      }

      default: {
        return [];
      }
    }
  }
}
