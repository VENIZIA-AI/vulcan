import { ExitCodes, ProjectLayout } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigLayers, ConfigLoader } from '../config/index.ts';
import { ConfigFormat } from '../config/format.ts';

const EFFECTIVE_FLAG = '--effective';
const DIFF_FLAG = '--diff';
const FORMAT_SUBCOMMAND = 'format';
const CHECK_FLAG = '--check';

/**
 * `vulcan config format [--check]`: puts the top-level keys of the config file in the order of `ConfigKeyOrder`, each with
 * its comments. `--check` writes nothing and exits 1 when a key would move.
 */
const runFormat = async (opts: ICommandContext): Promise<number> => {
  const rest = opts.args.slice(1);

  if (rest.length > 1 || (rest.length === 1 && rest[0] !== CHECK_FLAG)) {
    process.stderr.write(`vulcan config: format [${CHECK_FLAG}]\n`);

    return ExitCodes.USAGE;
  }

  const file = ConfigLoader.findFile({ root: opts.cwd });

  if (file === undefined) {
    process.stderr.write('vulcan config format: no .configs/vulcan.config.mts here\n');

    return ExitCodes.USAGE;
  }

  const result2 = await Bun.file(file).text();
  const result = ConfigFormat.format({ text: result2, root: opts.cwd });

  if (!result.ok) {
    process.stderr.write(`vulcan config format: cannot order the keys: ${result.reason}\n`);

    return ExitCodes.USAGE;
  }

  if (result.moved.length === 0) {
    process.stdout.write('the keys of the config are in order\n');

    return ExitCodes.OK;
  }

  if (rest.length === 1) {
    process.stderr.write(
      `${result.moved.length} key(s) out of order: ${result.moved.join(', ')}; run \`${ProjectLayout.VULCAN_COMMAND} config format\`\nthe order: ${result.keys.join(', ')}\n`,
    );

    return ExitCodes.FAILURE;
  }

  await Bun.write(file, result.text);
  process.stdout.write(`moved ${result.moved.join(', ')}; the order: ${result.keys.join(', ')}\n`);

  return ExitCodes.OK;
};

/**
 * `vulcan config`: shows the config as the commands read it. `--effective` prints the merge of the shipped layers and the
 * project file as JSON, with the layer each value came from and the `remove` entries that matched nothing. `--diff` lists
 * what the project file says that a shipped layer already gives. Read-only.
 */
export const runConfigCommand = async (opts: ICommandContext): Promise<number> => {
  if (opts.args[0] === FORMAT_SUBCOMMAND) {
    return runFormat(opts);
  }

  const wanted = opts.args.filter((arg) => arg === EFFECTIVE_FLAG || arg === DIFF_FLAG);

  if (wanted.length !== 1 || opts.args.length !== 1) {
    process.stderr.write(
      `vulcan config: ${EFFECTIVE_FLAG}, ${DIFF_FLAG} or ${FORMAT_SUBCOMMAND} [${CHECK_FLAG}]\n`,
    );

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
