import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentTable } from './table.ts';

const HOME_PREFIX = '~/';

const hasHomeEntry = (opts: { home: string; pattern: string }): boolean => {
  const relative = opts.pattern.slice(HOME_PREFIX.length);

  if (!relative.includes('*')) {
    return existsSync(join(opts.home, relative));
  }

  return (
    existsSync(opts.home) &&
    [...new Glob(relative).scanSync({ cwd: opts.home, onlyFiles: false, dot: true })].length > 0
  );
};

export class AgentDetection {
  /**
   * The agents this machine seems to have, in table order: a binary on PATH, a folder in the home, a
   * folder in the project. It only pre-selects; the developer confirms.
   */
  static detect(opts: { root: string; home: string; path: string }): string[] {
    return AgentTable.read()
      .filter((entry) => {
        const { binaries, homeDirs, projectDirs } = entry.detect;

        return (
          binaries.some((name) => Bun.which(name, { PATH: opts.path, cwd: opts.root }) !== null) ||
          homeDirs.some((pattern) => hasHomeEntry({ home: opts.home, pattern })) ||
          projectDirs.some((directory) => existsSync(join(opts.root, directory)))
        );
      })
      .map((entry) => entry.id);
  }
}
