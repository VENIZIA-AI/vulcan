import { spawnSyncBounded } from '@venizia/dev-configs/testing';

/**
 * `bun fmt --check` over the files matching `glob` under `root`, with the `bunfig.toml` found there:
 * the check that a file VULCAN rendered is already formatted. `cwd` is the project, so the `[fmt]`
 * section `init` wrote is the one in force.
 */
export const checkFiles = (opts: {
  root: string;
  glob: string;
}): { code: number; output: string } => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, 'fmt', '--no-script', '--check', opts.glob],
    cwd: opts.root,
  });

  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
};

/** Every package.json under `root`, sorted and laid out the way bun fmt wants. */
export const checkManifests = (opts: { root: string }): { code: number; output: string } =>
  checkFiles({ root: opts.root, glob: '**/package.json' });

/** The types the lint scope formats (make/fmt.mk): everything bun fmt supports except Markdown. */
export const FORMATTED_GLOB = '**/*.{ts,mts,tsx,js,mjs,json,jsonc,yml,yaml,css,html,vue}';
