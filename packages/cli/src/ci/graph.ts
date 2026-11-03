import { AffectedReasons } from './common/index.ts';
import type { IWorkspacePackage, TAffectedReason } from './common/index.ts';

/** Who depends on whom, inside the workspace. */
export class CiGraph {
  /**
   * `seeds` and every package that depends on one, directly or through others, each with the reason it is
   * on the list: a seed keeps its own, the others are `dependent`. A dependency on a workspace package
   * counts whatever its spec is (`workspace:*`, a range, `catalog:`), which can only add a package, never
   * lose one. Cycles end.
   */
  static closure(opts: {
    packages: IWorkspacePackage[];
    seeds: Map<string, TAffectedReason>;
  }): Map<string, TAffectedReason> {
    const names = new Set(opts.packages.map((entry) => entry.name));
    const dependents = new Map<string, string[]>();

    for (const entry of opts.packages) {
      for (const dependency of entry.dependencies) {
        if (names.has(dependency.name) && dependency.name !== entry.name) {
          dependents.set(dependency.name, [...(dependents.get(dependency.name) ?? []), entry.name]);
        }
      }
    }

    const reached = new Map<string, TAffectedReason>(opts.seeds);
    const queue = [...opts.seeds.keys()];

    while (queue.length > 0) {
      const name = queue.shift() ?? '';

      for (const dependent of dependents.get(name) ?? []) {
        if (!reached.has(dependent)) {
          reached.set(dependent, AffectedReasons.DEPENDENT);
          queue.push(dependent);
        }
      }
    }

    return reached;
  }
}
