import { join } from 'node:path';
import { ExitCodes, ProjectLayout } from '../common/index.ts';
import { runBun } from './process.ts';

/** The preset's own checks in the app, then the contract at the root; the first failure stops. */
export const runAppChecks = async (opts: {
  root: string;
  appDirectory: string;
  checks: string[];
}): Promise<number> => {
  for (const check of opts.checks) {
    const code = await runBun({
      cwd: opts.appDirectory,
      args: ['run', check],
      label: `bun run ${check} (${opts.appDirectory})`,
    });

    if (code !== ExitCodes.OK) {
      process.stderr.write(
        `vulcan: 'bun run ${check}' failed in ${opts.appDirectory} - the project is left as is for you to inspect\n`,
      );

      return code;
    }
  }

  const bin = join(opts.root, 'node_modules', '.bin', 'vulcan');

  for (const args of [
    [bin, 'doctor'],
    [bin, 'x', 'okf', 'check', '--strict'],
  ]) {
    const code = await runBun({
      cwd: opts.root,
      args,
      label: `${ProjectLayout.VULCAN_COMMAND} ${args.slice(1).join(' ')}`,
    });

    if (code !== ExitCodes.OK) {
      return code;
    }
  }

  return ExitCodes.OK;
};
