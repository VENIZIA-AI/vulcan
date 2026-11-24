import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { DoctorRunner } from '../doctor/index.ts';

export const runDoctorCommand = async (opts: ICommandContext): Promise<number> => {
  const report = await DoctorRunner.runReport({ root: opts.cwd });

  for (const violation of report.violations) {
    process.stderr.write(`  [${violation.check}] ${violation.file}: ${violation.message}\n`);
  }

  for (const warning of report.warnings) {
    process.stderr.write(`  warning [${warning.check}] ${warning.file}: ${warning.message}\n`);
  }

  for (const note of report.notes) {
    process.stderr.write(`  info [${note.check}] ${note.file}: ${note.message}\n`);
  }

  if (report.violations.length > 0) {
    process.stderr.write(`vulcan doctor: ${report.violations.length} violation(s)\n`);

    return ExitCodes.FAILURE;
  }

  process.stderr.write(
    report.warnings.length === 0
      ? 'vulcan doctor: OK\n'
      : `vulcan doctor: OK with ${report.warnings.length} warning(s)\n`,
  );

  return ExitCodes.OK;
};
