import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ExitCodes, ProjectLayout } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigConstants, ConfigGroups, ConfigLayers, ConfigLoader } from '../config/index.ts';
import { ConfigCodemod } from '../config/codemod.ts';
import { ConfigFormat } from '../config/format.ts';

const EFFECTIVE_FLAG = '--effective';
const DIFF_FLAG = '--diff';
const FORMAT_SUBCOMMAND = 'format';
const CODEMOD_SUBCOMMAND = 'codemod';
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
 * `vulcan config codemod config-groups [<dir>] [--write] [--split]`, and `--list`: the rewrite of the config into the seven groups.
 * Without `--write` it only says what it would write; `migrate apply` runs it with `--write`. It reads and writes under `.configs/` of the
 * folder, and deletes only under `.configs/vulcan/`: a path that leaves them, by `..` or by a link, is refused before a file is touched.
 */
/** Whether `path` of `root`, with every link in it followed, is inside `folder` of `root` (a path that does not exist yet counts by its nearest folder). */
const isInside = (opts: { root: string; path: string; folder: string }): boolean => {
  const base = join(opts.root, opts.folder);
  let at = resolve(opts.root, opts.path);

  while (!existsSync(at) && dirname(at) !== at) {
    at = dirname(at);
  }

  if (!existsSync(base)) {
    return resolve(opts.root, opts.path).startsWith(`${resolve(base)}${sep}`);
  }

  const real = realpathSync(at);
  const folder = realpathSync(base);

  return (
    resolve(opts.root, opts.path).startsWith(`${resolve(base)}${sep}`) &&
    (real === folder || real.startsWith(`${folder}${sep}`))
  );
};

const runCodemod = (opts: ICommandContext): number => {
  const rest = opts.args.slice(1);
  const flags = rest.filter((word) => word.startsWith('-'));
  const words = rest.filter((word) => !word.startsWith('-'));
  const unknown = flags.filter((flag) => !['--list', '--write', '--split'].includes(flag));

  if (unknown.length > 0 || words.length > 2) {
    process.stderr.write(
      `vulcan config codemod: ${ConfigCodemod.NAME} [<dir>] [--write] [--split] | --list\n`,
    );

    return ExitCodes.USAGE;
  }

  if (flags.includes('--list')) {
    // One name per line and nothing else: the changelog check reads the list as the names a codemod runner offers.
    process.stdout.write(`${ConfigCodemod.NAME}\n`);

    return ExitCodes.OK;
  }

  const [name, directory = '.'] = words;

  if (name !== ConfigCodemod.NAME) {
    process.stderr.write(
      `vulcan config codemod: unknown codemod '${name ?? ''}': the one there is is ${ConfigCodemod.NAME}\n`,
    );

    return ExitCodes.USAGE;
  }

  const root = resolve(opts.cwd, directory);
  const result = ConfigCodemod.run({
    root,
    // A file whose real path is outside the folder it is read from (a link out of `.configs/`) is not read.
    read: (path) =>
      existsSync(join(root, path)) && isInside({ root, path, folder: ConfigConstants.DIRECTORY })
        ? readFileSync(join(root, path), 'utf8')
        : undefined,
    split: flags.includes('--split'),
  });

  if (!result.ok) {
    process.stderr.write(`vulcan config codemod: nothing was written: ${result.reason}\n`);

    return ExitCodes.USAGE;
  }

  const isWriting = flags.includes('--write');
  const outside = result.changes.find(
    (change) =>
      !isInside({
        root,
        path: change.path,
        folder:
          change.text === undefined
            ? `${ConfigConstants.DIRECTORY}/vulcan`
            : ConfigConstants.DIRECTORY,
      }),
  );

  if (outside !== undefined) {
    process.stderr.write(
      `vulcan config codemod: nothing was written: ${outside.path} is ${outside.text === undefined ? 'not under .configs/vulcan/, where it deletes' : 'not under .configs/, where it writes'}\n`,
    );

    return ExitCodes.USAGE;
  }

  for (const note of result.notes) {
    process.stdout.write(`${note}\n`);
  }

  for (const change of result.changes) {
    const verb = change.text === undefined ? 'delete' : 'write';

    process.stdout.write(`${isWriting ? verb : `would ${verb}`}  ${change.path}\n`);

    if (!isWriting) {
      continue;
    }

    if (change.text === undefined) {
      rmSync(join(root, change.path), { force: true });
    } else {
      mkdirSync(dirname(join(root, change.path)), { recursive: true });
      writeFileSync(join(root, change.path), change.text);
    }
  }

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

  if (opts.args[0] === CODEMOD_SUBCOMMAND) {
    return runCodemod(opts);
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
          from: Object.fromEntries(
            Object.entries(loaded.layers.merge.from).map(([path, layer]) => [
              ConfigGroups.groupedPathOf({ path }),
              layer,
            ]),
          ),
          unmatchedRemove: loaded.layers.merge.unmatched.map((entry) =>
            ConfigGroups.groupedEntryOf({ entry }),
          ),
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
      : `${same.length} value(s) of the project config equal the shipped defaults; delete them:\n${same.map((path) => `  ${ConfigGroups.groupedPathOf({ path })}`).join('\n')}\n`,
  );

  return ExitCodes.OK;
};
