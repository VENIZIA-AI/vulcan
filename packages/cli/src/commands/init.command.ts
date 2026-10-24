import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigExtensions } from '../config/index.ts';
import { CreateFlags } from '../create/common/index.ts';
import { createMonorepo } from '../create/init-monorepo.ts';
import { runBun } from '../create/process.ts';
import { InitConstants, scaffoldProject } from '../init/index.ts';

export const runInitCommand = async (opts: ICommandContext): Promise<number> => {
  if (opts.args.includes(CreateFlags.PRESET)) {
    return createMonorepo({ cwd: opts.cwd, args: opts.args });
  }

  const flagIndex = opts.args.indexOf(InitConstants.CONFIG_FLAG);
  const requested = flagIndex === -1 ? ConfigExtensions.MTS : (opts.args[flagIndex + 1] ?? '');
  const extension = ConfigExtensions.LOOKUP_ORDER.find((value) => value === requested);

  if (extension === undefined) {
    process.stderr.write(
      `vulcan init: ${InitConstants.CONFIG_FLAG} takes one of ${ConfigExtensions.LOOKUP_ORDER.join(', ')}\n`,
    );

    return ExitCodes.FAILURE;
  }

  // Without it `bun add` walks up to a parent project and installs there.
  if (!existsSync(join(opts.cwd, 'package.json'))) {
    process.stderr.write(
      `vulcan init: no package.json in ${opts.cwd} - run 'bun init' first, or use --preset to create a new project\n`,
    );

    return ExitCodes.FAILURE;
  }

  const result = scaffoldProject({ root: opts.cwd, extension });

  for (const entry of result.entries) {
    process.stderr.write(`  ${entry.status.padEnd(8)} ${entry.subject}\n`);
  }

  let installCode: number = ExitCodes.OK;

  if (result.install.length > 0) {
    // Exact versions: V-S-05 pins what a project installs, and a range would drift on the next install.
    const args = ['add', '-d', '--exact', ...result.install];

    process.stderr.write(`installing ${result.install.join(' ')}\n`);
    installCode = await runBun({ cwd: opts.cwd, args, label: `bun ${args.join(' ')}` });

    if (installCode !== ExitCodes.OK) {
      process.stderr.write(`vulcan init: 'bun ${args.join(' ')}' failed - run it yourself\n`);
    }
  }

  process.stderr.write('left to do:\n');
  result.todo.forEach((line, index) => process.stderr.write(`  ${index + 1}. ${line}\n`));

  return installCode === ExitCodes.OK ? ExitCodes.OK : ExitCodes.FAILURE;
};
