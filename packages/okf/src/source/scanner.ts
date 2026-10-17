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

export const packageDirs = (): string[] => {
  const project = readOkfProject();

  // Every directory under packages/, in name order - the configured `packages` list is release order,
  // for atlas and releases; okf's tables have always listed directories by name.
  return listDirs({ dir: join(project.root, 'packages') }).filter(
    name => !project.denylist.has(name),
  );
};

export const exampleDirs = (): string[] => {
  const project = readOkfProject();

  return listDirs({ dir: join(project.root, 'examples') }).filter(
    name => !project.denylist.has(name),
  );
};
