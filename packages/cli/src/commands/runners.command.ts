import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { RunnersCheck } from '../runners/check.ts';

const USAGE = 'usage: vulcan runners check';

/**
 * `vulcan runners check`: lists every tracked file that runs an unscoped package through `bunx`, `bun x`, `npx`, `pnpm dlx`
 * or `yarn dlx`, one `file:line` each, and exits 1; exits 0 when there is none.
 */
export const runRunnersCommand = (opts: ICommandContext): Promise<number> => {
  if (opts.args[0] !== 'check' || opts.args.length !== 1) {
    process.stderr.write(`${USAGE}\n`);

    return Promise.resolve(ExitCodes.USAGE);
  }

  let findings;

  try {
    findings = RunnersCheck.scan({ root: opts.cwd });
  } catch (error) {
    process.stderr.write(
      `vulcan runners: ${error instanceof Error ? error.message : String(error)}\n`,
    );

    return Promise.resolve(ExitCodes.USAGE);
  }

  for (const finding of findings) {
    process.stderr.write(
      `${finding.file}:${finding.line}: ${finding.runner} ${finding.name} fetches a package by name; use \`bun run <bin>\` in the package that depends on it, or node_modules/.bin/<bin> (V-S-08)\n`,
    );
  }

  return Promise.resolve(findings.length === 0 ? ExitCodes.OK : ExitCodes.FAILURE);
};
