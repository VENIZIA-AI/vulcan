import { spawnSync } from 'node:child_process';
import { LocalConstants } from './constants.ts';

/** The questions the scan asks git. */
export class GitReader {
  /** What git prints for `args` in `cwd`, or `undefined` when it fails. */
  static run(opts: { cwd: string; args: string[] }): string | undefined {
    const result = spawnSync('git', opts.args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: LocalConstants.GIT_TIMEOUT_MS,
    });

    return result.status === 0 ? result.stdout : undefined;
  }
}
