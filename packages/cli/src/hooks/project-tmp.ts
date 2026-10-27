import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HookConstants } from './common/index.ts';

/** `<root>/.agents/local/tmp`: where a session's temporary files go, absolute. `vulcan clean` reads its age. */
export const projectTmpOf = (opts: { root: string }): string =>
  join(opts.root, HookConstants.PROJECT_TMP);

/** A word for `sh`, whatever it holds: in single quotes, a quote itself closed, escaped and opened again. */
const shellQuote = (opts: { text: string }): string => `'${opts.text.replaceAll("'", "'\\''")}'`;

/**
 * Makes every Bash command of a Claude Code session run with `TMPDIR` in the project. Claude Code hands a
 * SessionStart hook a file (`CLAUDE_ENV_FILE`) and sources it before each Bash command, so one `export`
 * there is enough: `mktemp`, bun, node and every script a command starts then use the project folder. It
 * does not move Claude Code's own task-output files or an MCP server (those need the launch file), and
 * `TMPDIR` in the project's settings `env` is not applied by Claude Code, which is why this is a hook.
 * Returns whether it wrote; with no file (another agent, a run outside Claude Code) it does nothing. A
 * path with a line break is refused: a line of shell must never be made from a folder name.
 */
export const exportProjectTmp = (opts: { root: string; envFile: string | undefined }): boolean => {
  if (opts.envFile === undefined || opts.envFile === '') {
    return false;
  }

  const folder = projectTmpOf({ root: opts.root });

  if (/[\r\n]/.test(folder)) {
    return false;
  }

  mkdirSync(folder, { recursive: true });
  appendFileSync(opts.envFile, `export TMPDIR=${shellQuote({ text: folder })}\n`);

  return true;
};
