import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from './project.helper.ts';

/**
 * An environment that does not depend on the machine running the test: a private HOME, a PATH of
 * bun and the system tools only (so no agent installed there is detected), and no global or system
 * git configuration (a hook, an identity or a template of the developer cannot change a repository
 * the test makes).
 */
export const hermeticEnv = (): Record<string, string> => {
  const bin = createProject({ files: {} });

  symlinkSync(process.execPath, join(bin, 'bun'));

  return {
    HOME: createProject({ files: {} }),
    PATH: `${bin}:/usr/bin:/bin`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
};
