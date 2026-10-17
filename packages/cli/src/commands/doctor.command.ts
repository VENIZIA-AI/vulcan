import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { runDoctorChecks } from '../doctor/index.ts';

export const runDoctorCommand = async (opts: ICommandContext): Promise<number> => {
  const violations = await runDoctorChecks({ root: opts.cwd });

  for (const violation of violations) {
    process.stderr.write(`  [${violation.check}] ${violation.file}: ${violation.message}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(`vulcan doctor: ${violations.length} violation(s)\n`);

    return ExitCodes.FAILURE;
  }

  process.stderr.write('vulcan doctor: OK\n');

  return ExitCodes.OK;
};
