import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resolve } from '@/changelogs/resolve';
import { VersionFolders } from '@/changelogs/version-folder';
import type { IAtlasPackage, IAtlasProject } from '@/common/project-config';
import { CodemodRunner } from '@/common/codemod-runner';
import { TextValue } from '@/common/text';
import { BreakingBadge } from './badges';
import { MigrationSchema } from './schema';
import { VersionCheck } from './version-check';

const DATED_ENTRY = /^(\d{4}-\d{2}-\d{2})-.*\.md$/;
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
      migrationFrom !== undefined && VersionFolders.isName({ name: migrationFrom })
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
            message: `migration '${item.id}' names codemod '${item.codemod}', which \`${CodemodRunner.listLabel({ command: opts.project.knowledge.codemodCommand })}\` does not offer`,
          });
        }
      }
    }

    return [...problems, ...VersionCheck.scan({ project: opts.project, codemods: opts.codemods })];
  }

  /** The packages a runner of the project's own may live in: the project's packages and the tool itself (`vulcan config codemod`). */
  private static trusted(opts: { packages: readonly string[] }): string[] {
    return [...opts.packages, CodemodRunner.TOOL_PACKAGE];
  }

  /** The codemod names the project's codemod runner offers, or `undefined` when it is not installed or cannot list them. */
  static codemodsOf(opts: {
    root: string;
    command?: string[];
    /** The npm names of the project's packages: a bin in `node_modules/.bin` must be installed inside one of them. */
    packages: readonly string[];
    /** The project's own packages: without a bin in `node_modules/.bin`, the `package.json` of one may declare it. */
    workspace?: readonly IAtlasPackage[];
  }): string[] | undefined {
    const listing = ChangelogCheck.listingOf(opts);

    return 'codemods' in listing ? listing.codemods : undefined;
  }

  private static listingOf(opts: {
    root: string;
    command?: string[];
    packages: readonly string[];
    workspace?: readonly IAtlasPackage[];
  }): { codemods: string[] } | { reason: string } {
    const [name, ...words] = opts.command ?? CodemodRunner.DEFAULT;
    const bin = CodemodRunner.binaryIn({ directory: opts.root, name });
    let command: string[];

    if (existsSync(bin)) {
      const refusal = CodemodRunner.refusalOf({
        directory: opts.root,
        name,
        packages: ChangelogCheck.trusted(opts),
      });

      if (refusal !== undefined) {
        return { reason: `${refusal}; a bin of ${CodemodRunner.TOOL_PACKAGE} is allowed here too` };
      }

      command = [bin];
    } else {
      const found = CodemodRunner.workspaceBinOf({
        root: opts.root,
        name,
        packages: opts.workspace ?? [],
      });

      if ('reason' in found) {
        return found;
      }

      // A built file of the workspace need not be executable: the runtime that runs the check runs it.
      command = [process.execPath, found.file];
    }

    const [program, ...leading] = command;
    const result = spawnSync(program, [...leading, ...words, '--list'], {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: DEVZ_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    if (result.status !== 0) {
      return { reason: `it exited ${result.status ?? result.signal ?? 'without starting'}` };
    }

    return {
      codemods: result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
  }

  /**
   * Prints the problems, one `file: message` line each, through `write`; the exit code is 0 when there are none. Names that cannot
   * be checked are a problem when the project declares `knowledge.codemodCommand` or an item names a codemod.
   */
  static run(opts: { project: IAtlasProject; write: (text: string) => void }): number {
    const command = opts.project.knowledge.codemodCommand;
    const listing = ChangelogCheck.listingOf({
      root: opts.project.root,
      command,
      packages: opts.project.packages.map((entry) => entry.name),
      workspace: opts.project.packages,
    });
    const codemods = 'codemods' in listing ? listing.codemods : undefined;
    const problems = ChangelogCheck.scan({ project: opts.project, codemods });
    let isUnchecked = false;

    if ('reason' in listing) {
      // With no names on offer, every codemod an item names is one more problem.
      isUnchecked =
        command !== undefined ||
        ChangelogCheck.scan({ project: opts.project, codemods: [] }).length > problems.length;

      const outcome = isUnchecked
        ? 'codemod names cannot be checked, so the check fails'
        : 'codemod names were not checked';

      opts.write(
        `changelog check: \`${CodemodRunner.listLabel({ command })}\` is not available (${listing.reason}); ${outcome}\n`,
      );
    }

    for (const problem of problems) {
      opts.write(`${problem.file}: ${problem.message}\n`);
    }

    return problems.length === 0 && !isUnchecked ? 0 : 1;
  }
}
