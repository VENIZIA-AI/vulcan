/** `bun` commands init and add run; VULCAN_NO_INSTALL=1 (tests) prints them instead. */
export const isInstallSkipped = (): boolean => process.env.VULCAN_NO_INSTALL === '1';

/** Any command, under the same skip rule as `runBun`; a skipped one counts as done. */
export const runCommand = async (opts: {
  cwd: string;
  command: string[];
  label: string;
}): Promise<number> => {
  if (isInstallSkipped()) {
    process.stderr.write(`  skipped  ${opts.label} (VULCAN_NO_INSTALL)\n`);

    return 0;
  }

  const child = Bun.spawn(opts.command, {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return child.exited;
};

export const runBun = async (opts: {
  cwd: string;
  args: string[];
  label: string;
}): Promise<number> =>
  runCommand({ cwd: opts.cwd, command: [process.execPath, ...opts.args], label: opts.label });
