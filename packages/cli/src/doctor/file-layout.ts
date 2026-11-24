import { ProjectLayout } from '../common/index.ts';
import { LayoutBaseline } from '../layout/baseline.ts';
import { LayoutCheck } from '../layout/check.ts';
import { LayoutConstants, LayoutRules } from '../layout/common/index.ts';
import type { ICheckContext } from './checks.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

const SHOWN_PATHS = 3;
const COMMAND = `${ProjectLayout.VULCAN_COMMAND} layout check`;

/** The layout check in the doctor: a warning per rule for the findings the baseline does not hold, a note for the ones it does. */
export class FileLayoutCheck {
  private static split(opts: ICheckContext) {
    const scan = LayoutCheck.scan({ root: opts.root, config: opts.config });
    const baseline = LayoutBaseline.read({ root: opts.root });

    if ('error' in scan) {
      return { skipped: true };
    }

    if ('error' in baseline) {
      return { error: baseline.error };
    }

    return LayoutBaseline.split({ findings: scan.findings, entries: baseline.entries });
  }

  /** One warning per rule with new findings, naming the first paths; one when the baseline cannot be read; none outside a git repository. Warnings. */
  static warnings(opts: ICheckContext): IViolation[] {
    const split = FileLayoutCheck.split(opts);

    if ('skipped' in split) {
      return [];
    }

    if ('error' in split) {
      return [{ check: DoctorChecks.FILE_LAYOUT, file: opts.configFile, message: split.error }];
    }

    return LayoutRules.values().flatMap((rule) => {
      const found = split.open.filter((finding) => finding.rule === rule);
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
  }

  /** How many findings the baseline holds, and how many of its entries match nothing. A note. */
  static notes(opts: ICheckContext): IViolation[] {
    const split = FileLayoutCheck.split(opts);

    if ('skipped' in split || 'error' in split) {
      return [];
    }

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

    return notes;
  }
}
