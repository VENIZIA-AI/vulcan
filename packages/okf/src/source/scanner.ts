import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXAMPLE_DENYLIST, PACKAGE_DENYLIST, PATHS, PRUNE_DIRS, REPO } from '../config.ts';

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
  return relative(REPO, opts.path);
};

export const packageDirs = (): string[] => {
  return listDirs({ dir: PATHS.packages }).filter(name => !PACKAGE_DENYLIST.has(name));
};

export const exampleDirs = (): string[] => {
  return listDirs({ dir: PATHS.examples }).filter(name => !EXAMPLE_DENYLIST.has(name));
};
