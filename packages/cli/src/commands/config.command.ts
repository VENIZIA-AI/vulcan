import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigLayers, ConfigLoader } from '../config/index.ts';

const EFFECTIVE_FLAG = '--effective';
const DIFF_FLAG = '--diff';

/**
 * `vulcan config`: shows the config as the commands read it. `--effective` prints the merge of the shipped layers and the
 * project file as JSON, with the layer each value came from and the `remove` entries that matched nothing. `--diff` lists
 * what the project file says that a shipped layer already gives. Read-only.
 */
export const runConfigCommand = async (opts: ICommandContext): Promise<number> => {
  const wanted = opts.args.filter((arg) => arg === EFFECTIVE_FLAG || arg === DIFF_FLAG);

  if (wanted.length !== 1 || opts.args.length !== 1) {
    process.stderr.write(`vulcan config: ${EFFECTIVE_FLAG} or ${DIFF_FLAG}\n`);

    return ExitCodes.USAGE;
  }

  const loaded = await ConfigLoader.load({ root: opts.cwd });

  if (!loaded.ok) {
    process.stderr.write(`vulcan config: ${loaded.error}\n`);

    return ExitCodes.FAILURE;
  }

  if (wanted[0] === EFFECTIVE_FLAG) {
    process.stdout.write(
      `${JSON.stringify(
        {
          config: loaded.config,
          from: loaded.layers.merge.from,
          unmatchedRemove: loaded.layers.merge.unmatched,
        },
        null,
        2,
      )}\n`,
    );

    return ExitCodes.OK;
  }

  const same = ConfigLayers.redundant({
    project: loaded.layers.project,
    below: loaded.layers.below,
  });

  process.stdout.write(
    same.length === 0
      ? 'nothing in the project config equals the shipped defaults\n'
      : `${same.length} value(s) of the project config equal the shipped defaults; delete them:\n${same.map((path) => `  ${path}`).join('\n')}\n`,
  );

  return ExitCodes.OK;
};
