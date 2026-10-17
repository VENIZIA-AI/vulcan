import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PRUNE_DIRS } from '../config.ts';
import { readOkfProject } from '../project/index.ts';

export const walkFiles = (opts: { dir: string }): string[] => {
  const { dir } = opts;

  const out: string[] = [];

  if (!existsSync(dir)) {
    return out;
  }

  for (const name of readdirSync(dir).sort()) {
    if (PRUNE_DIRS.has(name)) {
      continue;
    }

    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      out.push(...walkFiles({ dir: full }));
      continue;
    }

    out.push(full);
  }

  return out;
};

export const listDirs = (opts: { dir: string }): string[] => {
  const { dir } = opts;

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter(name => !PRUNE_DIRS.has(name) && statSync(join(dir, name)).isDirectory())
    .sort();
};

export const sourceFiles = (opts: { dir: string }): string[] => {
  return walkFiles({ dir: opts.dir }).filter(
    file => file.endsWith('.ts') && !file.endsWith('.d.ts'),
  );
};

export const repoRelative = (opts: { path: string }): string => {
  return relative(readOkfProject().root, opts.path);
};

/**
 * The packages okf documents, by directory name: the configured live ones that exist on disk,
 * wherever they live (an application keeps them outside packages/); with none configured, every
 * directory under packages/. The denylist applies to both. Name order, not the configured release
 * order - okf's tables have always listed packages by name.
 */
export const listPackages = (): { dir: string; path: string }[] => {
  const project = readOkfProject();
  const configured = project.packages
    .filter(entry => !entry.retired && existsSync(entry.path))
    .map(entry => ({ dir: entry.dir, path: entry.path }));
  const listed =
    project.packages.length > 0
      ? configured
      : listDirs({ dir: join(project.root, 'packages') }).map(dir => ({
          dir,
          path: join(project.root, 'packages', dir),
        }));

  return listed
    .filter(entry => !project.denylist.has(entry.dir))
    .sort((left, right) => (left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0));
};

export const packageDirs = (): string[] => listPackages().map(entry => entry.dir);

export const exampleDirs = (): string[] => {
  const project = readOkfProject();

  return listDirs({ dir: join(project.root, 'examples') }).filter(
    name => !project.denylist.has(name),
  );
};
