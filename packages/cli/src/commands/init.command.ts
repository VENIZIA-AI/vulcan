import { ExitCodes, ProjectLayout } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigExtensions } from '../config/index.ts';
import { InitConstants, scaffoldProject } from '../init/index.ts';

export const runInitCommand = async (opts: ICommandContext): Promise<number> => {
  const flagIndex = opts.args.indexOf(InitConstants.CONFIG_FLAG);
  const requested = flagIndex === -1 ? ConfigExtensions.MTS : (opts.args[flagIndex + 1] ?? '');
  const extension = ConfigExtensions.LOOKUP_ORDER.find(value => value === requested);

  if (extension === undefined) {
    process.stderr.write(
      `vulcan init: ${InitConstants.CONFIG_FLAG} takes one of ${ConfigExtensions.LOOKUP_ORDER.join(', ')}\n`,
    );

    return ExitCodes.FAILURE;
  }

  for (const entry of scaffoldProject({ root: opts.cwd, extension })) {
    process.stderr.write(`  ${entry.status.padEnd(8)} ${entry.subject}\n`);
  }

  process.stderr.write(
    `next: ${ProjectLayout.VULCAN_COMMAND} sync && ${ProjectLayout.VULCAN_COMMAND} doctor\n`,
  );

  return ExitCodes.OK;
};
