import { AffectedReasons, CiChecks, CiConstants } from './common/index.ts';
import type {
  IAffectedPackage,
  IAffectedResult,
  IWorkspacePackage,
  TAffectedReason,
  TCiCheck,
} from './common/index.ts';
import { CiGit } from './git.ts';
import { CiGlobal } from './global.ts';
import { CiGraph } from './graph.ts';
import { CiWorkspace } from './workspace.ts';

type TAffectedRun = { ok: true; result: IAffectedResult } | { ok: false; error: string };

/** Which packages a change touches. */
export class CiAffected {
  /**
   * Reads the workspace of the checked-out tree and the files that differ between `base` and `head`,
   * and says which packages are affected. `head` must be the commit that is checked out, because the
   * packages and their dependencies are read from the files on disk. A base of only zeros, what a
   * pipeline passes for a branch with no parent, has nothing to compare with: every package is affected.
   */
  static run(opts: { root: string; base: string; head: string }): TAffectedRun {
    const workspace = CiWorkspace.read({ root: opts.root });

    if (!workspace.ok) {
      return workspace;
    }

    const globs = CiGlobal.read({ root: opts.root });

    if (CiConstants.EMPTY_BASE.test(opts.base)) {
      return {
        ok: true,
        result: CiAffected.build({
          base: opts.base,
          head: opts.head,
          packages: workspace.packages,
          selection: {
            all: true,
            because: 'the base is empty (a new branch): nothing to compare with',
            reached: new Map(),
          },
        }),
      };
    }

    const head = CiGit.resolve({ root: opts.root, ref: opts.head });
    const base = CiGit.resolve({ root: opts.root, ref: opts.base });
    const checkedOut = CiGit.resolve({ root: opts.root, ref: 'HEAD' });

    if (!head.ok || !base.ok || !checkedOut.ok) {
      return {
        ok: false,
        error:
          [head, base, checkedOut].flatMap((step) => (step.ok ? [] : [step.error]))[0] ??
          'git failed',
      };
    }

    if (head.stdout !== checkedOut.stdout) {
      return {
        ok: false,
        error: `--head ${opts.head} is not the checked-out commit: the packages are read from the files on disk, so check ${opts.head} out first`,
      };
    }

    const changes = CiGit.changedFiles({ root: opts.root, base: base.stdout, head: head.stdout });

    if (!changes.ok) {
      return changes;
    }

    return {
      ok: true,
      result: CiAffected.build({
        base: base.stdout,
        head: head.stdout,
        packages: workspace.packages,
        selection: CiAffected.select({
          packages: workspace.packages,
          files: changes.files,
          globs,
        }),
      }),
    };
  }

  /**
   * The packages a set of changed files touches. Everything is affected when a file matches `globs` or the
   * otherwise a package is affected when one of its files changed or when a package it depends on is.
   */
  static select(opts: { packages: IWorkspacePackage[]; files: string[]; globs: string[] }): {
    all: boolean;
    because?: string;
    reached: Map<string, TAffectedReason>;
  } {
    const hit = CiGlobal.firstHit({ files: opts.files, globs: opts.globs });

    if (hit !== undefined) {
      return { all: true, because: hit, reached: new Map() };
    }

    const seeds = new Map<string, TAffectedReason>();

    for (const file of opts.files) {
      const owner = CiAffected.ownerOf({ packages: opts.packages, file });

      if (owner !== undefined) {
        seeds.set(owner.name, AffectedReasons.CHANGED);
      }
    }

    return { all: false, reached: CiGraph.closure({ packages: opts.packages, seeds }) };
  }

  /** The package whose folder holds `file`: the deepest one when folders nest. */
  private static ownerOf(opts: {
    packages: IWorkspacePackage[];
    file: string;
  }): IWorkspacePackage | undefined {
    let owner: IWorkspacePackage | undefined;

    for (const entry of opts.packages) {
      const isInside = opts.file === entry.dir || opts.file.startsWith(`${entry.dir}/`);

      if (isInside && (owner === undefined || entry.dir.length > owner.dir.length)) {
        owner = entry;
      }
    }

    return owner;
  }

  private static build(opts: {
    base: string;
    head: string;
    packages: IWorkspacePackage[];
    selection: { all: boolean; because?: string; reached: Map<string, TAffectedReason> };
  }): IAffectedResult {
    const { selection } = opts;
    const listed: IAffectedPackage[] = opts.packages
      .filter((entry) => selection.all || selection.reached.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        dir: entry.dir,
        reason: selection.all
          ? AffectedReasons.GLOBAL
          : (selection.reached.get(entry.name) ?? AffectedReasons.CHANGED),
        checks: CiAffected.checksOf({ scripts: entry.scripts }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      base: opts.base,
      head: opts.head,
      all: selection.all,
      ...(selection.all && selection.because !== undefined
        ? { allBecause: selection.because }
        : {}),
      packages: listed,
    };
  }

  /** The checks a package has: each standard script it defines, by the name that runs it. */
  private static checksOf(opts: {
    scripts: Record<string, string>;
  }): Partial<Record<TCiCheck, string>> {
    return Object.fromEntries(
      [...CiChecks.SCHEME_SET]
        .filter((check) => Object.hasOwn(opts.scripts, check))
        .map((check) => [check, check]),
    );
  }
}
