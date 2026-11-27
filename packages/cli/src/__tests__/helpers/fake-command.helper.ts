import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from './project.helper.ts';

/**
 * An executable shell script standing in for `bun` or `git` (through VULCAN_BUN / VULCAN_GIT), so a
 * test can make a command succeed, fail or print without the real tool or the network.
 */
export const createFakeCommand = (opts: { body: string }): string => {
  const root = createProject({ files: { 'fake-command': `#!/bin/sh\n${opts.body}\n` } });
  const path = join(root, 'fake-command');

  chmodSync(path, 0o755);

  return path;
};
