import { GraphConstants, GraphDecisions, GraphLevels } from './common/constants';
import type { IFingerprints } from './common/types';

export interface IRebuildPlan {
  decision: string;
  /** Why, in a sentence. */
  reason: string;
  /** The packages whose symbols are read again; all of them for a full build. */
  packages: string[];
  /** The files that changed structurally. */
  structural: string[];
  /** The files whose bytes changed and nothing else. */
  cosmetic: string[];
}

export class RebuildPlan {
  /** How a file moved between two builds. */
  static levelOf(opts: {
    before?: IFingerprints['files'][string];
    after?: IFingerprints['files'][string];
  }): string {
    const { before, after } = opts;

    if (before === undefined || after === undefined) {
      return before === after ? GraphLevels.NONE : GraphLevels.STRUCTURAL;
    }

    if (before.content === after.content) {
      return GraphLevels.NONE;
    }

    return before.surface === after.surface &&
      before.imports === after.imports &&
      before.manifest === after.manifest &&
      after.manifest !== true
      ? GraphLevels.COSMETIC
      : GraphLevels.STRUCTURAL;
  }

  /**
   * What the next build does, from the fingerprints of the last one and of now.
   * - skip: nothing structural moved, no package built new declarations, the graph file is there. Only the bytes and the time are recorded.
   * - full: no last build, `--full`, other settings or packages, a `package.json` changed, or more than 30 structural files
   *   or half of all. Everything is read again.
   * - partial: the rest. The files and imports are read again (cheap); the symbols are read again for the packages that
   *   hold a structural file or built new declarations, and for the packages that depend on them.
   */
  static decide(opts: {
    before?: IFingerprints;
    after: IFingerprints;
    full: boolean;
    hasGraph: boolean;
    /** The packages that depend on a package, directly, by npm name: the last graph's `depends` edges. */
    dependents: ReadonlyMap<string, string[]>;
  }): IRebuildPlan {
    const { before, after } = opts;
    const all = Object.keys(after.files);
    const packages = Object.keys(after.declarations);

    if (opts.full) {
      return RebuildPlan.full({ reason: '--full', packages });
    }

    if (before === undefined || !opts.hasGraph) {
      return RebuildPlan.full({ reason: 'no earlier build', packages });
    }

    if (before.inputs !== after.inputs) {
      return RebuildPlan.full({ reason: 'the packages or the graph settings changed', packages });
    }

    const paths = [...new Set([...Object.keys(before.files), ...all])].sort();
    const levels = paths.map((path) => ({
      path,
      level: RebuildPlan.levelOf({ before: before.files[path], after: after.files[path] }),
    }));
    const structural = levels
      .filter((item) => item.level === GraphLevels.STRUCTURAL)
      .map((item) => item.path);
    const cosmetic = levels
      .filter((item) => item.level === GraphLevels.COSMETIC)
      .map((item) => item.path);

    if (structural.some((path) => (after.files[path] ?? before.files[path])?.manifest === true)) {
      return RebuildPlan.full({ reason: 'a package.json changed', packages });
    }

    if (
      structural.length > GraphConstants.PARTIAL_MAX_STRUCTURAL ||
      structural.length > all.length * GraphConstants.FULL_SHARE
    ) {
      return RebuildPlan.full({
        reason: `${structural.length} files changed structurally`,
        packages,
      });
    }

    const touched = new Set(
      structural.flatMap((path) => {
        const owner = (after.files[path] ?? before.files[path])?.package;

        return owner === undefined || owner === '' ? [] : [owner];
      }),
    );

    for (const name of packages) {
      if (before.declarations[name] !== after.declarations[name]) {
        touched.add(name);
      }
    }

    if (touched.size === 0) {
      return {
        decision: GraphDecisions.SKIP,
        reason:
          cosmetic.length === 0
            ? 'nothing changed'
            : `${cosmetic.length} files changed in bytes only`,
        packages: [],
        structural,
        cosmetic,
      };
    }

    const queue = [...touched];

    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      for (const dependent of opts.dependents.get(name) ?? []) {
        if (!touched.has(dependent)) {
          touched.add(dependent);
          queue.push(dependent);
        }
      }
    }

    return {
      decision: GraphDecisions.PARTIAL,
      reason: `${structural.length} files changed structurally`,
      packages: [...touched].sort(),
      structural,
      cosmetic,
    };
  }

  private static full(opts: { reason: string; packages: string[] }): IRebuildPlan {
    return {
      decision: GraphDecisions.FULL,
      reason: opts.reason,
      packages: [...opts.packages].sort(),
      structural: [],
      cosmetic: [],
    };
  }
}
