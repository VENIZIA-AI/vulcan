import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigLoader } from '../config/index.ts';
import { LayoutBaseline } from '../layout/baseline.ts';
import { LayoutCheck } from '../layout/check.ts';
import { LayoutConstants } from '../layout/common/index.ts';

const USAGE = 'usage: vulcan layout check [--write-baseline]';
const WRITE_BASELINE_FLAG = '--write-baseline';

/**
 * `vulcan layout check`: prints every layout finding, a `warning` for one the baseline does not hold and an `info` for
 * one it does, and exits 1 when there is a new one. `--write-baseline` writes every finding into the baseline instead.
 */
export const runLayoutCommand = async (opts: ICommandContext): Promise<number> => {
  const [subcommand, ...rest] = opts.args;

  if (
    subcommand !== 'check' ||
    rest.length > 1 ||
    (rest.length === 1 && rest[0] !== WRITE_BASELINE_FLAG)
  ) {
    process.stderr.write(`${USAGE}\n`);

    return ExitCodes.USAGE;
  }

  const loaded = await ConfigLoader.load({ root: opts.cwd });

  if (!loaded.ok) {
    process.stderr.write(`vulcan layout: ${loaded.error}\n`);

    return ExitCodes.FAILURE;
  }

  const scan = LayoutCheck.scan({ root: opts.cwd, config: loaded.config });

  if ('outside' in scan) {
    process.stderr.write(`vulcan layout: ${opts.cwd} is not in a git work tree\n`);

    return ExitCodes.FAILURE;
  }

  if ('error' in scan) {
    process.stderr.write(`vulcan layout: ${scan.error}\n`);

    return ExitCodes.FAILURE;
  }

  if (rest.length === 1) {
    const count = LayoutBaseline.write({ root: opts.cwd, findings: scan.findings });

    process.stdout.write(`wrote ${count} finding(s) to ${LayoutConstants.BASELINE_FILE}\n`);

    return ExitCodes.OK;
  }

  const baseline = LayoutBaseline.read({ root: opts.cwd });

  if ('error' in baseline) {
    process.stderr.write(`vulcan layout: ${baseline.error}\n`);

    return ExitCodes.FAILURE;
  }

  const split = LayoutBaseline.split({ findings: scan.findings, entries: baseline.entries });

  for (const finding of split.open) {
    process.stderr.write(`  warning [${finding.rule}] ${finding.path}: ${finding.message}\n`);
  }

  for (const finding of split.accepted) {
    process.stderr.write(
      `  info [${finding.rule}] ${finding.path}: ${finding.message} (in the baseline)\n`,
    );
  }

  for (const entry of split.stale) {
    process.stderr.write(
      `  info [${entry.rule}] ${entry.path}: in the baseline, no longer found; run with ${WRITE_BASELINE_FLAG} to drop it\n`,
    );
  }

  process.stderr.write(
    `vulcan layout: ${split.open.length} new, ${split.accepted.length} in the baseline, ${split.stale.length} stale baseline entr${split.stale.length === 1 ? 'y' : 'ies'}\n`,
  );

  return split.open.length === 0 ? ExitCodes.OK : ExitCodes.FAILURE;
};
