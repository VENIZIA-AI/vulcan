import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readOkfProject } from '../project/index.ts';

/**
 * The structural coverage axes (`okf.coverage`): each `path` globs directories under the root, and
 * every matched directory, minus the denylist, needs a concept at `<name>/<directory>.md`. A path that
 * matches no directory is a problem - an axis that covers nothing passes by accident.
 */
export const collectCoverageAxes = (): {
  axes: { name: string; items: string[] }[];
  problems: string[];
} => {
  const project = readOkfProject();
  const axes: { name: string; items: string[] }[] = [];
  const problems: string[] = [];

  for (const axis of project.coverage) {
    const matched = [
      ...new Bun.Glob(axis.path).scanSync({ cwd: project.root, onlyFiles: false, dot: false }),
    ].filter(path => statSync(join(project.root, path)).isDirectory());

    if (matched.length === 0) {
      problems.push(`coverage: axis '${axis.name}' (${axis.path}) matches no directory`);
      continue;
    }

    const items = matched.map(path => basename(path)).filter(name => !project.denylist.has(name));

    axes.push({ name: axis.name, items: [...new Set(items)].sort() });
  }

  return { axes, problems };
};
