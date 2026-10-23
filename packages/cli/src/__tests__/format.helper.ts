import { spawnSyncBounded } from './spawn.helper.ts';

/**
 * `bun fmt --check` over every package.json under `root`, with the `bunfig.toml` found there: the
 * check that a manifest VULCAN rendered is already sorted. `cwd` is the project, so the `[fmt]`
 * section `init` wrote is the one in force.
 */
export const checkManifests = (opts: { root: string }): { code: number; output: string } => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, 'fmt', '--no-script', '--check', '**/package.json'],
    cwd: opts.root,
  });

  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
};
