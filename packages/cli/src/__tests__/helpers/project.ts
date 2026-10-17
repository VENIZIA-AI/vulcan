import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

export const removeProjects = (): void => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
};
