import { ProjectLayout } from '../common/index.ts';
import { LayoutBaseline } from '../layout/baseline.ts';
import { LayoutCheck } from '../layout/check.ts';
import { LayoutConstants, LayoutRules } from '../layout/common/index.ts';
import type { ILayoutFinding } from '../layout/common/index.ts';
import type { ICheckContext } from './checks.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

const SHOWN_PATHS = 3;
const COMMAND = `${ProjectLayout.VULCAN_COMMAND} check layout`;

/** One warning per rule with open findings: the path and what to do for one, the count and the first paths for more. */
const warningsOf = (opts: { open: ILayoutFinding[] }): IViolation[] =>
  LayoutRules.values().flatMap((rule) => {
    const found = opts.open.filter((finding) => finding.rule === rule);
    const paths = found.map((finding) => finding.path);

    if (found.length <= 1) {
      return found.map((finding) => ({
        check: DoctorChecks.FILE_LAYOUT,
        file: finding.path,
        message: `${rule}: ${finding.message}`,
      }));
    }

    return [
      {
        check: DoctorChecks.FILE_LAYOUT,
        file: `${paths.length} paths`,
        message: `${rule}: ${paths.slice(0, SHOWN_PATHS).join(', ')}${paths.length > SHOWN_PATHS ? ` and ${paths.length - SHOWN_PATHS} more` : ''}; run \`${COMMAND}\` for each one and what to do`,
      },
    ];
  });

const problemOf = (opts: { file: string; message: string }): IViolation => ({
  check: DoctorChecks.FILE_LAYOUT,
  file: opts.file,
  message: opts.message,
});

/** The layout check in the doctor, run once: warnings for the findings the baseline does not hold, notes for the ones it does. */
export class FileLayoutCheck {
  /**
   * Nothing outside a git work tree. A listing git did not give or a baseline that is not valid is one warning that says why.
   * The notes count the accepted findings and the baseline entries that match nothing.
   */
  static check(opts: ICheckContext): { warnings: IViolation[]; notes: IViolation[] } {
    const scan = LayoutCheck.scan({ root: opts.root, config: opts.config });

    if ('outside' in scan) {
      return { warnings: [], notes: [] };
    }

    const baseline = LayoutBaseline.read({ root: opts.root });

    if ('error' in scan) {
      return { warnings: [problemOf({ file: opts.configFile, message: scan.error })], notes: [] };
    }

    if ('error' in baseline) {
      return {
        warnings: [problemOf({ file: opts.configFile, message: baseline.error })],
        notes: [],
      };
    }

    const split = LayoutBaseline.split({ findings: scan.findings, entries: baseline.entries });
    const notes: IViolation[] = [];

    if (split.accepted.length > 0) {
      notes.push({
        check: DoctorChecks.FILE_LAYOUT,
        file: LayoutConstants.BASELINE_FILE,
        message: `${split.accepted.length} layout finding(s) accepted in the baseline`,
      });
    }

    if (split.stale.length > 0) {
      notes.push({
        check: DoctorChecks.FILE_LAYOUT,
        file: LayoutConstants.BASELINE_FILE,
        message: `${split.stale.length} baseline entr${split.stale.length === 1 ? 'y matches' : 'ies match'} nothing any more: run \`${COMMAND} --write-baseline\``,
      });
    }

    return { warnings: warningsOf({ open: split.open }), notes };
  }
}
