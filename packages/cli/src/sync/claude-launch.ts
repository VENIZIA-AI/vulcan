import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
