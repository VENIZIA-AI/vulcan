import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readOkfProject } from '../project/index.ts';

/**
 * The structural coverage axes (`okf.coverage`): each `path` globs directories under the root, and
 * every matched directory, minus the denylist, needs a concept at `<name>/<directory>.md`. A path that
 * matches no directory fails - an axis that covers nothing passes by accident.
 */
export const collectCoverageAxes = (): { name: string; items: string[] }[] => {
  const project = readOkfProject();

  return project.coverage.map(axis => {
    const matched = [
      ...new Bun.Glob(axis.path).scanSync({ cwd: project.root, onlyFiles: false, dot: false }),
    ].filter(path => statSync(join(project.root, path)).isDirectory());

    if (matched.length === 0) {
      throw new Error(`okf: coverage axis '${axis.name}' matches no directory (${axis.path})`);
    }

    const items = matched.map(path => basename(path)).filter(name => !project.denylist.has(name));

    return { name: axis.name, items: [...new Set(items)].sort() };
  });
};
