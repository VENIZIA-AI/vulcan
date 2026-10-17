import { relative } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { loadConfig } from '../config/index.ts';
import { diffBaseRules, planPrune, planSync, SyncConstants, SyncStatuses } from '../sync/index.ts';

const DRY_RUN_FLAG = '--dry-run';
const PRUNE_FLAG = '--prune';

export const runSyncCommand = async (opts: ICommandContext): Promise<number> => {
  const loaded = await loadConfig({ root: opts.cwd });

  if (!loaded.ok) {
    process.stderr.write(`vulcan sync: ${loaded.error}\n`);

    return ExitCodes.FAILURE;
  }

  const dryRun = opts.args.includes(DRY_RUN_FLAG);
  // Planned before anything is written: prune reads the managed record of the previous sync.
  const pruned = opts.args.includes(PRUNE_FLAG) ? planPrune({ root: opts.cwd }) : [];
  const actions = [...planSync({ root: opts.cwd, config: loaded.config }), ...pruned];
  // Read before the manifest action rewrites the hashes it compares against.
  const changes = diffBaseRules({ root: opts.cwd });

  for (const action of actions) {
    if (!dryRun) {
      action.apply();
    }

    const note = action.note === undefined ? '' : ` (${action.note})`;

    process.stderr.write(
      `  ${action.status.padEnd(9)} ${relative(opts.cwd, action.path)}${note}\n`,
    );
  }

  for (const { id, change, text } of changes) {
    process.stderr.write(`  ${change.padEnd(9)} ${[id, text].filter(Boolean).join(' ')}\n`);
  }

  const settingsBroken = actions.some(
    action =>
      action.status === SyncStatuses.SKIPPED && action.path.endsWith(SyncConstants.SETTINGS_FILE),
  );

  return settingsBroken ? ExitCodes.FAILURE : ExitCodes.OK;
};
