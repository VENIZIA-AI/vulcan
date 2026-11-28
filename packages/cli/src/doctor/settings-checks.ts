import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { ConfigGroups, ConfigLayers } from '../config/index.ts';
import { ProjectKey } from '../events/project-key.ts';
import { AgentConstants } from '../agents/common/index.ts';
import { EventConstants } from '../events/common/index.ts';
import { EventRetention } from '../events/retention.ts';
import { EventSettings } from '../events/settings.ts';
import { LocalFormat } from '../local/index.ts';
import { LocalSettings } from '../common/local-settings.ts';
import { DoctorChecks } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';
import { FallbackUtility } from '../common/utilities/fallback.utility.ts';

/** The checks of the settings of the config: the event log, the board, the project key and the shipped layers. */
export class SettingsChecks {
  /**
   * `events.dir` names a folder outside the project: it must exist and be writable by this user, or the
   * event hooks lose every line without a word (they fail open). A folder inside the project is made
   * on the first write and is not checked. A warning: the folder belongs to the machine, not to the repository.
   */
  static checkEventsDir(opts: ICheckContext): IViolation[] {
    // The folder of this checkout's local file replaces the committed config's; a problem with it is reported against that file.
    const own = EventSettings.localDir({ root: opts.root });
    const isOwn = own !== undefined;
    const dir = own ?? opts.config.events.dir;

    if (dir === undefined) {
      return [];
    }

    const away = relative(opts.root, dir);

    if (away !== '' && !away.startsWith('..') && !isAbsolute(away)) {
      return [];
    }

    const problem = ((): string | undefined => {
      if (!existsSync(dir)) {
        return `does not exist - create it (mkdir -p ${dir})`;
      }

      if (!statSync(dir).isDirectory()) {
        return 'is not a folder';
      }

      return FallbackUtility.of({
        read: () => {
          accessSync(dir, constants.W_OK);

          return undefined;
        },
        otherwise: 'is not writable by this user',
      });
    })();

    return problem === undefined
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.EVENTS_DIR,
            file: isOwn ? AgentConstants.LOCAL_FILE : opts.configFile,
            message: `board.events.dir ${dir} ${problem}, so the event log hooks cannot write there`,
          }),
        ];
  }

  /** `board.serve.autoStart` with `events.log` off: the session start starts no board then. A note. */
  static checkBoardAutoStart(opts: ICheckContext): IViolation[] {
    return LocalSettings.read({ root: opts.root }).autoStart === true && !opts.config.events.log
      ? [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.BOARD_AUTOSTART,
            file: opts.configFile,
            message:
              'board.serve.autoStart is on in .agents/local/profile.json, but board.events.log is off, so the session start does not start the board: set board.events.log to true',
          }),
        ]
      : [];
  }

  /** Lines of the config that repeat what the shipped layers give: how many, and the command that lists them. A note. */
  static checkConfigDefaults(opts: ICheckContext): IViolation[] {
    if (opts.layers === undefined) {
      return [];
    }

    const same = ConfigLayers.redundant({ project: opts.layers.project, below: opts.layers.below });

    return same.length === 0
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.CONFIG_DEFAULTS,
            file: opts.configFile,
            message: `${same.length} value(s) of this config repeat what VULCAN ships: run \`${ProjectLayout.VULCAN_COMMAND} config diff\` to list them, then delete them`,
          }),
        ];
  }

  /** A `remove` entry that takes out nothing (the item is not in the merged array, or the array is not one a layer fills): a stale opt-out. A warning. */
  static checkStaleRemove(opts: ICheckContext): IViolation[] {
    return (opts.layers?.merge.unmatched ?? []).map((entry) =>
      DoctorCheckUtility.createViolation({
        check: DoctorChecks.CONFIG_REMOVE,
        file: opts.configFile,
        message: `remove: ${ConfigGroups.groupedEntryOf({ entry })} matches nothing, so it does nothing: delete it`,
      }),
    );
  }

  /**
   * Today's file of the event log alone is bigger than `events.maxSize`. The retention never truncates a file and never
   * removes today's, so nothing else will shrink it: the project raises the limit or writes fewer lines. A warning.
   */
  static checkEventsSize(opts: ICheckContext): IViolation[] {
    const own = EventSettings.localDir({ root: opts.root });
    const settings = { ...opts.config.events, ...(own === undefined ? {} : { dir: own }) };

    if (!EventRetention.isActive({ settings })) {
      return [];
    }

    const dir = EventSettings.dirOf({ root: opts.root, settings });
    const limits = EventRetention.limitsOf({ settings });
    const plan = EventRetention.plan({ dir, limits, now: Date.now() });

    return plan.todayOver
      ? [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.EVENTS_SIZE,
            file: opts.configFile,
            message: `today's event file in ${dir} is ${LocalFormat.formatBytes({ bytes: plan.todayBytes })}, over board.events.maxSize (${settings.maxSize ?? EventConstants.DEFAULT_MAX_SIZE}); nothing is truncated and today's file is never removed - raise maxSize or write fewer events`,
          }),
        ]
      : [];
  }

  /**
   * The event log is on and the project has no `project.key`: flows cannot be created, because a flow is named
   * `VULZ-<key>-<number>`. A warning: the log still takes lines of flows made before.
   */
  static checkProjectKey(opts: ICheckContext): IViolation[] {
    return opts.config.events.log && opts.config.project === undefined
      ? [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.PROJECT_KEY,
            file: opts.configFile,
            message: `the event log is on and project.key is not set, so no flow can be created: add project: { key: 'KEY' } (${ProjectKey.MESSAGE}), then run vulcan project sync`,
          }),
        ]
      : [];
  }
}
