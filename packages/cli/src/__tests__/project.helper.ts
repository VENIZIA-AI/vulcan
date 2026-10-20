import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const createdRoots: string[] = [];

/** A throwaway project directory holding exactly `files` (path to content). */
export const createProject = (opts: { files: Record<string, string> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-project-'));

  createdRoots.push(root);

  for (const [path, content] of Object.entries(opts.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  return root;
};

/**
 * A registry-shaped tarball of a folder: unlike a `file:` folder dependency, which bun installs as
 * symlinks, it unpacks into real files, the way a published package does.
 */
export const packFolder = (opts: { folder: string }): string => {
  const destination = createProject({ files: {} });
  const result = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', destination, '--quiet'], {
    cwd: opts.folder,
  });

  if (result.exitCode !== 0) {
    throw new Error(`bun pm pack failed in ${opts.folder}: ${result.stderr.toString()}`);
  }

  const [tarball] = readdirSync(destination).filter(name => name.endsWith('.tgz'));

  return join(destination, tarball);
};

export const removeProjects = (): void => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
};
