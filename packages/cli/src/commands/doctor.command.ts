import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { DoctorRunner } from '../doctor/index.ts';

export const runDoctorCommand = async (opts: ICommandContext): Promise<number> => {
  const violations = await DoctorRunner.runChecks({ root: opts.cwd });

  for (const violation of violations) {
    process.stderr.write(`  [${violation.check}] ${violation.file}: ${violation.message}\n`);
  }

  const warnings = await DoctorRunner.runWarnings({ root: opts.cwd });

  for (const warning of warnings) {
    process.stderr.write(`  warning [${warning.check}] ${warning.file}: ${warning.message}\n`);
  }

  const doctorNotes = await DoctorRunner.runNotes({ root: opts.cwd });

  for (const note of doctorNotes) {
    process.stderr.write(`  info [${note.check}] ${note.file}: ${note.message}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(`vulcan doctor: ${violations.length} violation(s)\n`);

    return ExitCodes.FAILURE;
  }

  process.stderr.write(
    warnings.length === 0
      ? 'vulcan doctor: OK\n'
      : `vulcan doctor: OK with ${warnings.length} warning(s)\n`,
  );

  return ExitCodes.OK;
};
