import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { ProjectTmp } from '../hooks/project-tmp.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

/** Beside the other personal files of the developer, gitignored with them. */
export const CLAUDE_LAUNCH_FILE = `${ProjectLayout.LOCAL_DIRECTORY}/claude.launch.settings.json`;

export class LaunchSettings {
  /**
   * What `claude --settings <this file>` adds to a session: `TMPDIR` and `CLAUDE_CODE_TMPDIR` in the project.
   * Claude Code applies an `env` block given this way (and the variables in the launch environment, and the
   * user settings file), but not the same block in the project's own settings, so this is the route that
   * moves its own task-output files and its MCP servers into the project. Absolute paths: the file belongs
   * to one checkout of one developer.
   */
  static renderClaude(opts: { root: string; tmp?: string }): string {
    const folder = ProjectTmp.projectOf(opts);

    return `${JSON.stringify({ env: { TMPDIR: folder, CLAUDE_CODE_TMPDIR: folder } }, null, 2)}\n`;
  }

  /** The launch file when it is missing or written for another folder; nothing to do when it is current. */
  static planClaude(opts: { root: string; tmp?: string }): ISyncAction[] {
    const path = join(opts.root, CLAUDE_LAUNCH_FILE);
    const text = LaunchSettings.renderClaude(opts);
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
  }
}

const inside = (opts: { folder: string; base: string }): boolean => {
  const path = relative(opts.base, opts.folder);

  return !isAbsolute(path) && path !== '..' && !path.startsWith('../');
};

/** A path as the disk has it (a symlink followed), or as written when it does not exist yet. */
const realOf = (opts: { path: string }): string => {
  try {
    return realpathSync(opts.path);
  } catch {
    return resolve(opts.path);
  }
};

export class ClaudeLaunch {
  /** The one line that starts Claude Code in this project; the docs and the warning print this string. */
  static readonly COMMAND = `claude --settings ${CLAUDE_LAUNCH_FILE}`;
  /** Under the local folder of a checkout: the worktrees of its branches. */
  static readonly WORKTREES = 'worktrees';

  /**
   * Where `CLAUDE_CODE_TMPDIR` points, for a session in `root`: `unset`, `inside` or `outside`. Inside is a folder under
   * the `.agents/local` of the project, or under that of the checkout a worktree of the project hangs from
   * (`<checkout>/.agents/local/worktrees/<name>`): a trailing slash, a subfolder and a symlinked root do not matter.
   */
  static tmpOf(opts: { root: string; env: Record<string, string | undefined> }): {
    state: 'unset' | 'inside' | 'outside';
    folder?: string;
  } {
    const folder = opts.env.CLAUDE_CODE_TMPDIR;

    if (folder === undefined || folder === '') {
      return { state: 'unset' };
    }

    const real = realOf({ path: folder });
    const root = realOf({ path: opts.root });
    const homes = [root];

    for (let above = dirname(root); above !== dirname(above); above = dirname(above)) {
      if (
        inside({
          folder: root,
          base: join(above, ProjectLayout.LOCAL_DIRECTORY, ClaudeLaunch.WORKTREES),
        })
      ) {
        homes.push(above);
      }
    }

    const isInProjectTmp = [opts.root, ...homes].some((home) =>
      inside({ folder: real, base: realOf({ path: ProjectTmp.projectOf({ root: home }) }) }),
    );
    const isInLocal = homes.some((home) =>
      inside({ folder: real, base: join(home, ProjectLayout.LOCAL_DIRECTORY) }),
    );

    return { state: isInProjectTmp || isInLocal ? 'inside' : 'outside', folder };
  }

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

    const tmp = ClaudeLaunch.tmpOf(opts);

    if (tmp.state === 'inside') {
      return undefined;
    }

    return `Claude Code was started without the project's launch file: CLAUDE_CODE_TMPDIR is ${
      tmp.state === 'unset' ? 'not set' : `${tmp.folder}, outside the project`
    }, so its scratchpad and task output are written outside the project and the owner will be asked to approve each write there. Say so in your first reply. To fix it, quit and start Claude Code with: ${ClaudeLaunch.COMMAND}`;
  }
}
