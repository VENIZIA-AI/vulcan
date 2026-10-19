/** `bun` commands init and add run; VULCAN_NO_INSTALL=1 (tests) prints them instead. */
export const isInstallSkipped = (): boolean => process.env.VULCAN_NO_INSTALL === '1';

export const runBun = async (opts: {
  cwd: string;
  args: string[];
  label: string;
}): Promise<number> => {
  if (isInstallSkipped()) {
    process.stderr.write(`  skipped  ${opts.label} (VULCAN_NO_INSTALL)\n`);

    return 0;
  }

  const child = Bun.spawn([process.execPath, ...opts.args], {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return child.exited;
};
