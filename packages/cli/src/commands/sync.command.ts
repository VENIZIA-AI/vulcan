import { relative } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { loadConfig } from '../config/index.ts';
import { planSync, SyncConstants, SyncStatuses } from '../sync/index.ts';

const DRY_RUN_FLAG = '--dry-run';

export const runSyncCommand = async (opts: ICommandContext): Promise<number> => {
  const loaded = await loadConfig({ root: opts.cwd });

  if (!loaded.ok) {
    process.stderr.write(`vulcan sync: ${loaded.error}\n`);

    return ExitCodes.FAILURE;
  }

  const dryRun = opts.args.includes(DRY_RUN_FLAG);
  const actions = planSync({ root: opts.cwd, config: loaded.config });

  for (const action of actions) {
    if (!dryRun) {
      action.apply();
    }

    const note = action.note === undefined ? '' : ` (${action.note})`;

    process.stderr.write(
      `  ${action.status.padEnd(9)} ${relative(opts.cwd, action.path)}${note}\n`,
    );
  }

  const settingsBroken = actions.some(
    action =>
      action.status === SyncStatuses.SKIPPED && action.path.endsWith(SyncConstants.SETTINGS_FILE),
  );

  return settingsBroken ? ExitCodes.FAILURE : ExitCodes.OK;
};
