import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { projectTmpOf } from '../hooks/project-tmp.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

/** Beside the other personal files of the developer, gitignored with them. */
export const CLAUDE_LAUNCH_FILE = `${ProjectLayout.LOCAL_DIRECTORY}/claude.launch.settings.json`;

/**
 * What `claude --settings <this file>` adds to a session: `TMPDIR` and `CLAUDE_CODE_TMPDIR` in the project.
 * Claude Code applies an `env` block given this way (and the variables in the launch environment, and the
 * user settings file), but not the same block in the project's own settings, so this is the route that
 * moves its own task-output files and its MCP servers into the project. Absolute paths: the file belongs
 * to one checkout of one developer.
 */
export const renderClaudeLaunch = (opts: { root: string }): string => {
  const folder = projectTmpOf({ root: opts.root });

  return `${JSON.stringify({ env: { TMPDIR: folder, CLAUDE_CODE_TMPDIR: folder } }, null, 2)}\n`;
};

/** The launch file when it is missing or written for another folder; nothing to do when it is current. */
export const planClaudeLaunch = (opts: { root: string }): ISyncAction[] => {
  const path = join(opts.root, CLAUDE_LAUNCH_FILE);
  const text = renderClaudeLaunch({ root: opts.root });
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;

  if (before === text) {
    return [];
  }

  return [
    {
      path,
      status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
      note:
        before === undefined
          ? 'the Claude Code launch file is missing'
          : 'the Claude Code launch file names another folder',
      apply: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
    },
  ];
};

export class ClaudeLaunch {
  /** The one line that starts Claude Code in this project; the docs and the warning print this string. */
  static readonly COMMAND = `claude --settings ${CLAUDE_LAUNCH_FILE}`;

  /**
   * What to tell the owner when a Claude Code session runs without the launch file: `CLAUDE_CODE_TMPDIR` is unset
   * or points outside the project, so Claude Code's own scratchpad and task output land outside it and writes
   * there need approval. Undefined for any other agent, for a project without the file, and for a session
   * that already uses a folder inside the project.
   */
  static missWarning(opts: {
    root: string;
    env: Record<string, string | undefined>;
  }): string | undefined {
    if (
      opts.env.CLAUDE_PROJECT_DIR === undefined ||
      !existsSync(join(opts.root, CLAUDE_LAUNCH_FILE))
    ) {
      return undefined;
    }

    const folder = opts.env.CLAUDE_CODE_TMPDIR;
    const fromRoot =
      folder === undefined || folder === '' ? undefined : relative(opts.root, folder);

    if (fromRoot !== undefined && !isAbsolute(fromRoot) && !fromRoot.startsWith('..')) {
      return undefined;
    }

    return `Claude Code was started without the project's launch file: CLAUDE_CODE_TMPDIR is ${
      fromRoot === undefined ? 'not set' : `${folder}, outside the project`
    }, so its scratchpad and task output are written outside the project and the owner will be asked to approve each write there. Say so in your first reply. To fix it, quit and start Claude Code with: ${ClaudeLaunch.COMMAND}`;
  }
}
