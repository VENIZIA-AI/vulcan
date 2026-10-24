import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { CleanScopes, formatAge, formatBytes, planClean, runClean } from '../local/index.ts';
import type { ILocalEntry } from '../local/index.ts';

const YES_FLAG = '--yes';
const ALL_FLAG = '--all';

const lineOf = (opts: { entry: ILocalEntry }): string => {
  const { entry } = opts;
  const note = entry.note === '' ? (entry.state === 'stale' ? 'stale' : '') : entry.note;

  return `  ${entry.scope}/${entry.name}  ${formatBytes({ bytes: entry.bytes })}  ${formatAge({ ageMs: entry.ageMs })}${note === '' ? '' : `  ${note}`}`;
};

/**
 * `vulcan clean`: lists what the chosen scopes of `.agents/local/` would remove, with size and age, and
 * removes it with `--yes`. A dry run by default. It touches only `.agents/local/` of this project.
 */
export const runCleanCommand = async (opts: ICommandContext): Promise<number> => {
  const named = opts.args
    .filter((arg) => arg.startsWith('--') && CleanScopes.isValid(arg.slice(2)))
    .map((arg) => arg.slice(2));
  const scopes = opts.args.includes(ALL_FLAG)
    ? [...new Set([...CleanScopes.ALL, ...named])]
    : named.length > 0
      ? named
      : [CleanScopes.TMP];
  const yes = opts.args.includes(YES_FLAG);
  const plan = planClean({ root: opts.cwd, scopes });
  const total = plan.remove.reduce((sum, entry) => sum + entry.bytes, 0);

  if (plan.remove.length === 0 && plan.keep.length === 0) {
    process.stderr.write(`vulcan clean: nothing to remove in ${scopes.join(', ')}\n`);

    return ExitCodes.OK;
  }

  process.stderr.write(
    yes ? 'vulcan clean: removing\n' : 'vulcan clean: dry run, nothing is removed (add --yes)\n',
  );

  for (const entry of plan.remove) {
    process.stderr.write(`${lineOf({ entry })}\n`);
  }

  for (const entry of plan.keep) {
    process.stderr.write(`  kept ${entry.scope}/${entry.name}  ${entry.note}\n`);
  }

  if (!yes) {
    process.stderr.write(
      `would remove ${plan.remove.length} item(s), ${formatBytes({ bytes: total })}\n`,
    );

    return ExitCodes.OK;
  }

  const result = runClean({ root: opts.cwd, plan });

  for (const failure of result.failed) {
    process.stderr.write(
      `  failed ${failure.entry.scope}/${failure.entry.name}: ${failure.error}\n`,
    );
  }

  process.stderr.write(
    `removed ${result.removed.length} item(s), ${formatBytes({ bytes: result.removed.reduce((sum, entry) => sum + entry.bytes, 0) })}\n`,
  );

  return result.failed.length === 0 ? ExitCodes.OK : ExitCodes.FAILURE;
};
