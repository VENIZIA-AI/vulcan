import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git, initRepo } from '../git-repo.helper.ts';
import { createProject } from '../project.helper.ts';

export interface IPackageSpec {
  name: string;
  /** Dependency name to spec, in `dependencies`. */
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export const ALL_SCRIPTS = {
  typecheck: 'tsc',
  lint: 'oxlint',
  test: 'bun test',
  compile: 'tsc -b',
};

export const json = (opts: { value: unknown }): string =>
  `${JSON.stringify(opts.value, null, 2)}\n`;

/** Writes files (path to text) under `root`; a value of `null` deletes the file. */
export const writeFiles = (opts: { root: string; files: Record<string, string | null> }): void => {
  for (const [path, text] of Object.entries(opts.files)) {
    if (text === null) {
      rmSync(join(opts.root, path), { force: true, recursive: true });
      continue;
    }

    mkdirSync(dirname(join(opts.root, path)), { recursive: true });
    writeFileSync(join(opts.root, path), text);
  }
};

/**
 * A git repository with a root `package.json` and one folder per package under `packages/`, committed on
 * `develop`. `commit` then commits a change on top of it.
 */
export const workspaceRepo = (opts: {
  packages: Record<string, IPackageSpec>;
  root?: Record<string, unknown>;
  files?: Record<string, string>;
}): string => {
  const root = createProject({ files: {} });
  const files: Record<string, string> = {
    'package.json': json({
      value: { name: 'root', private: true, workspaces: ['packages/*'], ...opts.root },
    }),
    ...opts.files,
  };

  for (const [dir, spec] of Object.entries(opts.packages)) {
    files[`packages/${dir}/package.json`] = json({
      value: { ...spec, scripts: spec.scripts ?? ALL_SCRIPTS },
    });
    files[`packages/${dir}/src/index.ts`] = `export const ${dir.replace(/\W/g, '_')} = 1;\n`;
  }

  writeFiles({ root, files });
  git({ cwd: root, args: ['init', '--quiet', '-b', 'develop'] });
  initRepo({ cwd: root });

  return root;
};

/** Commits `files` (a `null` deletes) and returns the new commit. */
export const commit = (opts: { root: string; files: Record<string, string | null> }): string => {
  writeFiles(opts);
  git({ cwd: opts.root, args: ['add', '-A'] });
  git({ cwd: opts.root, args: ['commit', '--quiet', '-m', 'change'] });

  return git({ cwd: opts.root, args: ['rev-parse', 'HEAD'] });
};
