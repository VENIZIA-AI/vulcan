import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectGuards } from '../hooks/project-guards.ts';
import { RunnerScan } from '../hooks/runner-scan.ts';

/** One command in a tracked file that runs a package fetched by name. */
export interface IRunnerFinding {
  /** Repository-relative path. */
  file: string;
  line: number;
  /** The package or bin the command would fetch. */
  name: string;
  /** The runner as written. */
  runner: string;
}

/** What a scan found: the commands to fix, and how many refused commands a Markdown file marked as examples. */
export interface IRunnersScan {
  findings: IRunnerFinding[];
  examples: number;
}

const MAX_BYTES = 1024 * 1024;
/** Not instructions: a lockfile, a build output, a vendored folder, a test, a fixture. */
const SKIPPED_PATH =
  /(^|\/)(node_modules|dist|build|coverage|__tests__|__fixtures__|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
/** A dated changelog file: history, frozen once written. */
const DATED_ENTRY = /(^|\/)changelogs?\/\d{4}-\d{2}-\d{2}-[^/]*\.md$/;
/** A file of a version folder, whose `log.md` says `released:` once the stable is out. */
const VERSION_FILE = /^(.*\/)?(\d+\.\d+\.\d+)\/(log\.md|migration\.yaml)$/;
/** The only files that may set a command apart as an example: prose. A script, a workflow or a Makefile never can. */
const MARKDOWN = /\.mdx?$/i;
const BINARY_EXTENSION = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|zip|gz|tgz|wasm|mp4|mov)$/i;

/**
 * `vulcan runners check`: no tracked file of the project may run an unscoped package through `bunx`, `bun x`, `npx`,
 * `pnpm dlx`, `pnpx` or `yarn dlx`, with or without `--no-install`. A scoped package (`@scope/name`) passes. A name npm owns for somebody else would be fetched and run
 * wherever the bin is not linked, and bun runs a copy an earlier bare bunx saved even under `--no-install`. The safe
 * forms are `bun run <bin>` in the package that depends on it, and the `node_modules/.bin` path.
 */
export class RunnersCheck {
  private static trackedFiles(opts: { root: string }): string[] {
    const listed = Bun.spawnSync(['git', 'ls-files', '-z'], {
      cwd: opts.root,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (listed.exitCode !== 0) {
      throw new Error(`git ls-files failed in ${opts.root}: ${listed.stderr.toString().trim()}`);
    }

    return listed.stdout
      .toString()
      .split('\0')
      .filter((file) => file !== '');
  }

  /** Whether the history of the project owns `file`: a dated entry, or a file of a version folder already released. */
  private static isFrozen(opts: { root: string; file: string }): boolean {
    if (DATED_ENTRY.test(opts.file)) {
      return true;
    }

    const version = VERSION_FILE.exec(opts.file);

    if (version === null) {
      return false;
    }

    try {
      return /^released:/m.test(
        readFileSync(join(opts.root, `${version[1] ?? ''}${version[2]}`, 'log.md'), 'utf8'),
      );
    } catch {
      return false;
    }
  }

  static scan(opts: { root: string }): IRunnersScan {
    const { runnersAllow } = ProjectGuards.readPolicy({ root: opts.root });
    const findings: IRunnerFinding[] = [];
    let examples = 0;

    for (const file of RunnersCheck.trackedFiles({ root: opts.root })) {
      if (
        SKIPPED_PATH.test(file) ||
        BINARY_EXTENSION.test(file) ||
        RunnersCheck.isFrozen({ root: opts.root, file })
      ) {
        continue;
      }

      let text: string;

      try {
        const buffer = readFileSync(join(opts.root, file));

        if (buffer.length > MAX_BYTES || buffer.subarray(0, 8000).includes(0)) {
          continue;
        }

        text = buffer.toString('utf8');
      } catch {
        continue;
      }

      for (const use of RunnerScan.find({ text, isMarkdown: MARKDOWN.test(file) })) {
        const name = RunnerScan.refusedName({ use, allow: runnersAllow });

        if (name === undefined) {
          continue;
        }

        if (use.isExample) {
          examples += 1;
        } else {
          findings.push({
            file,
            line: use.line,
            name,
            runner: `${use.runner}${use.hasNoInstall ? ' --no-install' : ''}`,
          });
        }
      }
    }

    return { findings, examples };
  }
}
