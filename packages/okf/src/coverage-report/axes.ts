import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readOkfProject } from '../project/index.ts';

export interface ICoverageAxis {
  name: string;
  items: string[];
  /** Each item's directory from the project root. */
  paths: Record<string, string>;
}

/** A `resource` as a key: no leading `./`, no trailing slash. */
const resourceKeyOf = (opts: { value: string }): string =>
  opts.value.replace(/^\.\//, '').replace(/\/+$/, '');

/** The `resource` of every concept, as keys for `isItemCovered`; reserved files (index, log) cover nothing. */
export const resourceKeysOf = (opts: {
  concepts: { resource: string; reserved: boolean }[];
}): Set<string> =>
  new Set(
    opts.concepts
      .filter((concept) => !concept.reserved && concept.resource !== '')
      .map((concept) => resourceKeyOf({ value: concept.resource })),
  );

/**
 * THE coverage rule, shared by `coverage` and `check --strict`: an axis item is covered by a concept
 * at `/<axis>/<item>` (`ids`), or by any concept whose `resource` is the item's directory.
 */
export const isItemCovered = (opts: {
  axis: ICoverageAxis;
  item: string;
  ids: Set<string>;
  resources: Set<string>;
}): boolean =>
  opts.ids.has(`/${opts.axis.name}/${opts.item}`) ||
  opts.resources.has(opts.axis.paths[opts.item] ?? opts.item);

/**
 * The structural coverage axes (`okf.coverage`): each `path` globs directories under the root, and
 * every matched directory, minus the denylist, the axis's own `denylist` and its `exclude` globs, needs a concept at `<name>/<directory>.md` - or any
 * concept whose frontmatter `resource` is the directory (`paths` maps each item to it). A path that
 * matches no directory is a problem - an axis that covers nothing passes by accident.
 */
export const collectCoverageAxes = (): {
  axes: ICoverageAxis[];
  problems: string[];
} => {
  const project = readOkfProject();
  const axes: ICoverageAxis[] = [];
  const problems: string[] = [];

  for (const axis of project.coverage) {
    const matched = [
      ...new Bun.Glob(axis.path).scanSync({ cwd: project.root, onlyFiles: false, dot: false }),
    ].filter((path) => statSync(join(project.root, path)).isDirectory());

    if (matched.length === 0) {
      problems.push(`coverage: axis '${axis.name}' (${axis.path}) matches no directory`);
      continue;
    }

    const excluded = axis.exclude.map((pattern) => new Bun.Glob(pattern));
    const kept = matched.filter(
      (path) =>
        !project.denylist.has(basename(path)) &&
        !axis.denylist.includes(basename(path)) &&
        !excluded.some((glob) => glob.match(path)),
    );

    if (kept.length === 0) {
      problems.push(
        `coverage: axis '${axis.name}' (${axis.path}) has no directory left after exclude/denylist`,
      );
      continue;
    }

    const items = [...new Set(kept.map((path) => basename(path)))].sort();

    axes.push({
      name: axis.name,
      items,
      paths: Object.fromEntries(kept.map((path) => [basename(path), path])),
    });
  }

  return { axes, problems };
};
