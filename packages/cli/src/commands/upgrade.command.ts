import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';

/** Every VULCAN release is a prerelease on the `next` dist-tag until a stable channel exists. */
const DEFAULT_TARGET = 'next';
const PACKAGE_NAME = '@venizia/vulcan';

export const buildUpgradeArgs = (opts: { target?: string }): string[] => [
  'add',
  '--dev',
  '--exact',
  `${PACKAGE_NAME}@${opts.target ?? DEFAULT_TARGET}`,
];

/**
 * Runs `sync` from the CLI the install just wrote, as a child: this process still holds the old
 * version's code and base, so an in-process sync would write the old adapters.
 */
export const runInstalledSync = async (opts: { cwd: string }): Promise<number> => {
  const bin = join(opts.cwd, 'node_modules', '.bin', 'vulcan');

  if (!existsSync(bin)) {
    process.stderr.write(
      `vulcan upgrade: no installed vulcan at ${bin} - the install did not complete\n`,
    );

    return ExitCodes.FAILURE;
  }

  const child = Bun.spawn([process.execPath, bin, 'sync'], {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return child.exited;
};

/** Installs the target version, then syncs with it, so the adapters always match the installed base. */
export const runUpgradeCommand = async (opts: ICommandContext): Promise<number> => {
  const install = Bun.spawn([process.execPath, ...buildUpgradeArgs({ target: opts.args[0] })], {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  const code = await install.exited;

  return code === ExitCodes.OK ? runInstalledSync({ cwd: opts.cwd }) : code;
};
