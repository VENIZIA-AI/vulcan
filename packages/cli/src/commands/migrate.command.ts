import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigLoader } from '../config/index.ts';
import { runXCommand } from './x.command.ts';

const SUBCOMMANDS = new Set(['plan', 'apply']);

/**
 * The project a folder belongs to: the nearest folder at or above `cwd` that has a VULCAN config, never
 * above the git work tree root (a config of an unrelated parent is not this project's). `undefined` when
 * there is none, so the folder is served as it is and atlas says there is nothing to serve.
 */
const enclosingProjectOf = (opts: { cwd: string }): string | undefined => {
  let directory = opts.cwd;

  for (;;) {
    if (ConfigLoader.findFile({ root: directory }) !== undefined) {
      return directory;
    }

    const parent = dirname(directory);

    if (existsSync(join(directory, '.git')) || parent === directory) {
      return undefined;
    }

    directory = parent;
  }
};

/** `--app` made absolute against the folder the command was run in, and added (as that folder) when absent. */
const withApp = (opts: { args: string[]; cwd: string }): string[] => {
  const args = [...opts.args];
  const at = args.findIndex((arg) => arg === '--app' || arg.startsWith('--app='));

  if (at === -1) {
    return [...args, '--app', opts.cwd];
  }

  if (args[at] === '--app') {
    args[at + 1] = resolve(opts.cwd, args[at + 1] ?? '');
  } else {
    args[at] = `--app=${resolve(opts.cwd, args[at].slice('--app='.length))}`;
  }

  return args;
};

/** `vulcan migrate plan|apply`: atlas's `migrate` run at the pinned version, over the sources this project serves. */
export const runMigrateCommand = (opts: ICommandContext): Promise<number> => {
  if (!SUBCOMMANDS.has(opts.args[0] ?? '')) {
    process.stderr.write(
      'usage: vulcan migrate plan [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json] [--verbose]\n       vulcan migrate apply [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--force]\n',
    );

    return Promise.resolve(ExitCodes.USAGE);
  }

  const project = enclosingProjectOf({ cwd: opts.cwd });

  // Run in the project that has the config; the app is the folder the command was run in unless `--app` says otherwise.
  return project === undefined || project === opts.cwd
    ? runXCommand({ ...opts, args: ['atlas', 'migrate', ...opts.args] })
    : runXCommand({
        ...opts,
        cwd: project,
        args: ['atlas', 'migrate', ...withApp({ args: opts.args, cwd: opts.cwd })],
      });
};
