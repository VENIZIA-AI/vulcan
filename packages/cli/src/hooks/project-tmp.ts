import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LayoutFolder } from '../common/layout-folder.ts';
import { RecordValue } from '../common/record.ts';
import { HookConstants } from './common/index.ts';
import { ProjectGuards } from './project-guards.ts';

/** A word for `sh`, whatever it holds: in single quotes, a quote itself closed, escaped and opened again. */
const shellQuote = (opts: { text: string }): string => `'${opts.text.replaceAll("'", "'\\''")}'`;

export class ProjectTmp {
  /**
   * The folder the project names for its temporary files, relative to its root: `local.tmp` of the committed manifest
   * (which `vulcan sync` renders from the config), read here so a hook needs no config loader. A missing manifest, a
   * missing key or a value that is not a layout folder gives the default, `.agents/local/tmp`.
   */
  static relativeOf(opts: { root: string }): string {
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

  /** What a caller that holds the config passes as `tmp`: the key, or the default when the project does not set it (never the manifest, which `sync` has not rewritten yet). */
  static configuredOf(opts: { tmp: string | undefined }): string {
    return opts.tmp ?? HookConstants.PROJECT_TMP;
  }

  /**
   * Where a session's temporary files go, absolute: the guard, the session digest, the session-start export, the launch
   * file, `vulcan clean` and the scratch of `add` all call this. `tmp` is the config's `local.tmp` for a caller that
   * has just read the config (`sync`, which writes the manifest after it plans the launch file); the others leave it
   * out and get the manifest's.
   */
  static projectOf(opts: { root: string; tmp?: string }): string {
    return join(opts.root, opts.tmp ?? ProjectTmp.relativeOf({ root: opts.root }));
  }

  /**
   * Makes every Bash command of a Claude Code session run with `TMPDIR` in the project. Claude Code hands a
   * SessionStart hook a file (`CLAUDE_ENV_FILE`) and sources it before each Bash command, so one `export`
   * there is enough: `mktemp`, bun, node and every script a command starts then use the project folder. It
   * does not move Claude Code's own task-output files or an MCP server (those need the launch file), and
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
