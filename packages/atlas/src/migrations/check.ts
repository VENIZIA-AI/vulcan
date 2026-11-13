import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resolve } from '@/changelogs/resolve';
import type { IAtlasProject } from '@/common/project-config';
import { TextValue } from '@/common/text';
import { BreakingBadge } from './badges';
import { MigrationSchema } from './schema';
import { VersionCheck } from './version-check';

const DATED_ENTRY = /^(\d{4}-\d{2}-\d{2})-.*\.md$/;
const VERSION_CUTOVER = /^\d+\.\d+\.\d+$/;
const BREAKING = BreakingBadge.CANONICAL;
const BREAKING_SHORT = BreakingBadge.SHORT;
const DEVZ_TIMEOUT_MS = 30_000;

/** One reason an entry fails the check; `file` is the entry's name in the changelog folder. */
export interface IChangelogProblem {
  file: string;
  message: string;
}

export class ChangelogCheck {
  /**
   * Every problem of the changelog entries that carry or owe a `migration` block. An entry dated before
   * the project's cutover (`knowledge.migrationFrom`) is never read; with no cutover no entry owes a
   * block, but one that carries a block is still checked. `codemods` is the list `devz codemod` offers:
   * absent, a codemod name is not checked.
   */
  static scan(opts: { project: IAtlasProject; codemods?: string[] }): IChangelogProblem[] {
    const { changelogs: directory, migrationFrom, datedUntil } = opts.project.knowledge;

    if (directory === undefined || !existsSync(directory)) {
      return [];
    }

    // A version cutover (`0.4.5`) retires the dated files: they are history and no longer owe a block.
    const cutover =
      migrationFrom !== undefined && VERSION_CUTOVER.test(migrationFrom)
        ? undefined
        : migrationFrom;
    const isVersioned = migrationFrom !== undefined && cutover === undefined;
    const problems: IChangelogProblem[] = [];
    const idOwners = new Map<string, string>();
    const files = readdirSync(directory)
      .filter((file) => DATED_ENTRY.test(file))
      .sort((left, right) => TextValue.compare({ left, right }));

    for (const file of files) {
      const date = DATED_ENTRY.exec(file)?.[1] ?? '';

      if (datedUntil !== undefined && date > datedUntil) {
        problems.push({
          file,
          message: `a dated entry after ${datedUntil}: write the item in changelogs/<X.Y.Z>/log.md of its version`,
        });
      }

      if (isVersioned || (cutover !== undefined && date < cutover)) {
        continue;
      }

      const text = readFileSync(join(directory, file), 'utf8');
      let data: Record<string, unknown>;

      try {
        data = Resolve.splitFrontmatter(text).data;
      } catch (error) {
        problems.push({ file, message: `invalid frontmatter: ${TextValue.messageOf({ error })}` });

        continue;
      }

      const badges: unknown[] = Array.isArray(data.badges) ? data.badges : [];
      const isBreaking = BreakingBadge.isIn({ text, badges });
      const isShort = BreakingBadge.SHORT_PATTERN.test(text) || badges.includes(BREAKING_SHORT);

      if (cutover !== undefined && isShort) {
        problems.push({
          file,
          message: `the badge \`${BREAKING_SHORT}\` is not the canonical spelling: use "${BREAKING}"`,
        });
      }

      if (data.migration === undefined) {
        if (isBreaking && cutover !== undefined) {
          problems.push({
            file,
            message: `a ${BREAKING} entry needs a \`migration:\` block (how an app upgrades and downgrades across it)`,
          });
        }

        continue;
      }

      const parsed = MigrationSchema.safeParse(data.migration);

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          problems.push({ file, message: `migration.${issue.path.join('.')}: ${issue.message}` });
        }

        continue;
      }

      for (const item of parsed.data) {
        const owner = idOwners.get(item.id);

        if (owner !== undefined) {
          problems.push({
            file,
            message: `migration id '${item.id}' is used in both ${owner} and ${file}; an id is unique across the changelog folder`,
          });
        }

        idOwners.set(item.id, owner ?? file);

        if (
          opts.codemods !== undefined &&
          item.codemod !== undefined &&
          !opts.codemods.includes(item.codemod)
        ) {
          problems.push({
            file,
            message: `migration '${item.id}' names codemod '${item.codemod}', which \`devz codemod --list\` does not offer`,
          });
        }
      }
    }

    return [...problems, ...VersionCheck.scan({ project: opts.project, codemods: opts.codemods })];
  }

  /** The codemod names the project's `devz` offers, or `undefined` when it is not installed or cannot list them. */
  static codemodsOf(opts: { root: string; command?: string[] }): string[] | undefined {
    const [name, ...words] = opts.command ?? ['devz', 'codemod'];
    const bin = join(opts.root, 'node_modules', '.bin', name);

    if (!existsSync(bin)) {
      return undefined;
    }

    const result = spawnSync(bin, [...words, '--list'], {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: DEVZ_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    if (result.status !== 0) {
      return undefined;
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /** Prints the problems, one `file: message` line each, through `write`; the exit code is 0 when there are none. */
  static run(opts: { project: IAtlasProject; write: (text: string) => void }): number {
    const codemods = ChangelogCheck.codemodsOf({
      root: opts.project.root,
      command: opts.project.knowledge.codemodCommand,
    });
    const problems = ChangelogCheck.scan({ project: opts.project, codemods });

    if (codemods === undefined) {
      opts.write(
        'changelog check: `devz codemod --list` is not available; codemod names were not checked\n',
      );
    }

    for (const problem of problems) {
      opts.write(`${problem.file}: ${problem.message}\n`);
    }

    return problems.length === 0 ? 0 : 1;
  }
}
