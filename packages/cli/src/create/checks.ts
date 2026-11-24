import { ExitCodes } from '../common/index.ts';
import { SubProcess } from './process.ts';

export class AppChecks {
  /** The preset's own checks in the app, then the contract at the root; the first failure stops. */
  static async run(opts: {
    root: string;
    appDirectory: string;
    checks: string[];
  }): Promise<number> {
    for (const check of opts.checks) {
      const code = await SubProcess.runBun({
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

    for (const check of [
      { scope: 'project', action: 'doctor', args: [] },
      { scope: 'okf', action: 'check', args: ['--strict'] },
    ]) {
      const code = await SubProcess.runVulcan({ cwd: opts.root, root: opts.root, ...check });

      if (code !== ExitCodes.OK) {
        return code;
      }
    }

    return ExitCodes.OK;
  }
}
