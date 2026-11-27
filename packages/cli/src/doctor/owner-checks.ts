import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentFiles } from '../sync/index.ts';
import { PrivateValues } from './private-values.ts';
import { ReplySwitch, OwnerConstants, OwnerReplySwitch, OwnerProfile } from '../owner/index.ts';
import { DoctorChecks, PrivateValueKinds } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';

/** The checks of what is personal or private: the owner profile, the owner reply switch and private values in committed files. */
export class OwnerChecks {
  /** The personal profile: a file that cannot be read is named, and one git tracks is a personal file about to be shared. */
  static checkProfile(opts: ICheckContext): IViolation[] {
    const read = OwnerProfile.read({ root: opts.root });
    const violations: IViolation[] = [];

    if (!read.ok) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.PROFILE,
          file: OwnerConstants.PROFILE_FILE,
          message: read.error.includes('removed: it is')
            ? `${read.error}`
            : `${read.error} - fix the key it names; the file also holds this machine's keys (agent, board, common), so 'vulcan profile reset --yes' keeps the valid ones and drops a broken one`,
        }),
      );
    }

    if (
      existsSync(join(opts.root, OwnerConstants.PROFILE_FILE)) &&
      !OwnerProfile.profileIsIgnored({ root: opts.root })
    ) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.PROFILE,
          file: OwnerConstants.PROFILE_FILE,
          message:
            'git does not ignore this personal file - add .agents/local/ to .gitignore (vulcan project sync does it)',
        }),
      );
    }

    if (
      existsSync(join(opts.root, OwnerConstants.PROFILE_FILE)) &&
      AgentFiles.isTracked({ root: opts.root, path: OwnerConstants.PROFILE_FILE })
    ) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.PROFILE,
          file: OwnerConstants.PROFILE_FILE,
          message:
            'git tracks this personal file - run: git rm --cached .agents/local/profile.json (and keep .agents/local/ in .gitignore)',
        }),
      );
    }

    return violations;
  }

  /** The owner cards are off for this shell (`VULCAN_OWNER_REPLY=off`): a session an agent starts sets it, an owner who exported it by mistake sees why the rules carry no shape card; a note, never a failure. */
  static checkOwnerReplySwitch(opts: { env: Record<string, string | undefined> }): IViolation[] {
    return ReplySwitch.isOwnerOff({ env: opts.env })
      ? [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.LOCAL,
            file: OwnerReplySwitch.ENV,
            message: `set to ${OwnerReplySwitch.OFF} in this shell: a session started from here gets no owner shape card and no profile card in its rules. Unset it for a session whose reader is the owner`,
          }),
        ]
      : [];
  }

  /** A Claude Code settings file of the project sets `VULCAN_OWNER_REPLY=off` in `env`: every session of the project then gets no owner shape card. A warning, never a failure. */
  static checkOwnerReplySettings(opts: { root: string }): IViolation[] {
    return ['.claude/settings.json', '.claude/settings.local.json'].flatMap((file) => {
      const env = DoctorCheckUtility.readJsonObject({ file: join(opts.root, file) })?.['env'];

      return typeof env === 'object' &&
        env !== null &&
        Reflect.get(env, OwnerReplySwitch.ENV) === OwnerReplySwitch.OFF
        ? [
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.LOCAL,
              file,
              message: `env sets ${OwnerReplySwitch.ENV}=${OwnerReplySwitch.OFF}: every session of this project gets no owner shape card and no profile card. Remove it and set the variable on the command that starts a session whose reader is an agent`,
            }),
          ]
        : [];
    });
  }

  /**
   * Private values in committed files, never the text: one warning per file that holds a key, a token or a URL
   * credential, with the kinds and counts; the files that hold only addresses or machine paths (an example IP in a
   * policy file, a path in a doc) in one warning; and one per acknowledgment that covered nothing.
   */
  static checkPrivateValues(opts: ICheckContext): IViolation[] {
    const { findings, unmatched } = PrivateValues.scan({
      root: opts.root,
      acknowledged: opts.config.doctor.privateValues.acknowledged,
    });
    const where = 'check.doctor.privateValues.acknowledged';
    const kindsOf = (counts: Record<string, number | undefined>): string =>
      Object.entries(counts)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ');
    const isMild = (finding: { counts: Record<string, number | undefined> }): boolean =>
      Object.keys(finding.counts).every((kind) =>
        [PrivateValueKinds.IPV4, PrivateValueKinds.MACHINE_PATH].includes(kind),
      );
    const mild = findings.filter((finding) => isMild(finding));

    return [
      ...findings
        .filter((finding) => !isMild(finding))
        .map((finding) =>
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.PRIVATE_VALUES,
            file: finding.file,
            message: `holds private values: ${kindsOf(finding.counts)} (not shown); remove them, or record the decision in ${where}`,
          }),
        ),
      ...(mild.length === 0
        ? []
        : [
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.PRIVATE_VALUES,
              file: mild.length === 1 ? mild[0].file : `${mild.length} files`,
              message: `${mild.length === 1 ? 'holds' : `${mild.length} files hold`} only addresses or machine paths: ${mild.map((finding) => `${finding.file} (${kindsOf(finding.counts)})`).join(', ')} (not shown); remove them, or record the decision in ${where}`,
            }),
          ]),
      ...unmatched
        .filter((entry) => entry.standing !== true)
        .map((entry) =>
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.PRIVATE_VALUES,
            file: opts.configFile,
            message: `${where}: "${entry.path}"${entry.types === undefined ? '' : ` (${entry.types.join(', ')})`} matches no file that holds such a value: remove the entry, or it covers files added later`,
          }),
        ),
    ];
  }

  /** What the project acknowledged, in one note: how many files hold values it decided to keep. It scans only when something is acknowledged. */
  static checkAcknowledgedValues(opts: ICheckContext): IViolation[] {
    const acknowledged = opts.config.doctor.privateValues.acknowledged;
    const { acknowledgedFiles } = acknowledged.every((entry) => entry.standing === true)
      ? { acknowledgedFiles: 0 }
      : PrivateValues.scan({ root: opts.root, acknowledged });

    return acknowledgedFiles === 0
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.PRIVATE_VALUES,
            file: opts.configFile,
            message: `${acknowledgedFiles} ${acknowledgedFiles === 1 ? 'file' : 'files'} acknowledged in check.doctor.privateValues.acknowledged`,
          }),
        ];
  }
}
