import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LayoutFolder } from '../common/layout-folder.ts';
import { LocalSettings } from '../common/local-settings.ts';
import { RecordValue } from '../common/record.ts';
import { HookConstants } from './common/index.ts';
import { ProjectGuards } from './project-guards.ts';

/** A word for `sh`, whatever it holds: in single quotes, a quote itself closed, escaped and opened again. */
const shellQuote = (opts: { text: string }): string => `'${opts.text.replaceAll("'", "'\\''")}'`;

export class ProjectTmp {
  /**
   * The folder the project names for its temporary files, relative to its root: `local.tmp` of the committed manifest
   * (which `vulcan project sync` renders from the config), read here so a hook needs no config loader, unless this checkout's
   * `.agents/local/profile.json` sets `local.tmp`, which replaces it. A missing manifest, a
   * missing key or a value that is not a layout folder gives the default, `.agents/tmp`.
   */
  static relativeOf(opts: { root: string }): string {
    const own = LocalSettings.read({ root: opts.root }).tmp;

    if (own !== undefined) {
      return own;
    }

    try {
      const manifest: unknown = JSON.parse(
        readFileSync(join(opts.root, ProjectGuards.MANIFEST_FILE), 'utf8'),
      );
      const local = RecordValue.isRecord(manifest) ? manifest['local'] : undefined;
      const tmp = RecordValue.isRecord(local) ? local['tmp'] : undefined;

      return typeof tmp === 'string' &&
        LayoutFolder.layoutFolderProblem({ folder: tmp }) === undefined
        ? tmp
        : HookConstants.PROJECT_TMP;
    } catch {
      return HookConstants.PROJECT_TMP;
    }
  }

  /** The same for a caller that writes something uncommitted (`sync`'s folder and ignore line, `doctor`): this checkout's own `local.tmp` first. */
  static effectiveOf(opts: { root: string; tmp: string | undefined }): string {
    return (
      LocalSettings.read({ root: opts.root }).tmp ?? ProjectTmp.configuredOf({ tmp: opts.tmp })
    );
  }

  /** What a caller that holds the config passes as `tmp`: the key, or the default when the project does not set it (never the manifest, which `sync` has not rewritten yet). */
  static configuredOf(opts: { tmp: string | undefined }): string {
    return opts.tmp ?? HookConstants.PROJECT_TMP;
  }

  /**
   * Where a session's temporary files go, absolute: the guard, the session digest, the session-start export,
   * `vulcan project clean` and the scratch of `add` all call this. `tmp` is the config's `local.tmp` for a caller that
   * has just read the config (`sync`, which writes the manifest after it plans the folder); the others leave it
   * out and get the manifest's.
   */
  static projectOf(opts: { root: string; tmp?: string }): string {
    return join(opts.root, opts.tmp ?? ProjectTmp.relativeOf({ root: opts.root }));
  }

  /**
   * Makes every Bash command of a Claude Code session run with `TMPDIR` in the project. Claude Code hands a
   * SessionStart hook a file (`CLAUDE_ENV_FILE`) and sources it before each Bash command, so one `export`
   * there is enough: `mktemp`, bun, node and every script a command starts then use the project folder. It
   * does not move Claude Code's own task-output files or an MCP server (those need the variable in the launch environment), and
   * `TMPDIR` in the project's settings `env` is not applied by Claude Code, which is why this is a hook.
   * Returns whether it wrote; with no file (another agent, a run outside Claude Code) it does nothing. A
   * path with a line break is refused: a line of shell must never be made from a folder name.
   */
  static exportProjectTmp(opts: { root: string; envFile: string | undefined }): boolean {
    if (opts.envFile === undefined || opts.envFile === '') {
      return false;
    }

    const folder = ProjectTmp.projectOf({ root: opts.root });

    if (/[\r\n]/.test(folder)) {
      return false;
    }

    mkdirSync(folder, { recursive: true });
    appendFileSync(opts.envFile, `export TMPDIR=${shellQuote({ text: folder })}\n`);

    return true;
  }
}
