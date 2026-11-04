import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { ConfigLoader } from '../config/index.ts';
import { CreateFlags } from '../create/common/index.ts';
import { KeyChoice } from '../create/project-key.ts';
import { Monorepo } from '../create/init-monorepo.ts';
import { SubProcess } from '../create/process.ts';
import { ProjectScaffold } from '../init/index.ts';
import { ProfilePrompt } from './profile.command.ts';

export const runInitCommand = async (opts: ICommandContext): Promise<number> => {
  if (opts.args.includes(CreateFlags.PRESET)) {
    return Monorepo.create({ cwd: opts.cwd, args: opts.args });
  }

  // Without it `bun add` walks up to a parent project and installs there.
  if (!existsSync(join(opts.cwd, 'package.json'))) {
    process.stderr.write(
      `vulcan init: no package.json in ${opts.cwd} - run 'bun init' first, or use --preset to create a new project\n`,
    );

    return ExitCodes.FAILURE;
  }

  // The key is asked for only when init is about to write the config: an existing config keeps the one it has.
  let key: string | undefined;

  if (ConfigLoader.findFile({ root: opts.cwd }) === undefined) {
    const choice = KeyChoice.resolve({
      args: opts.args,
      name: ProjectScaffold.nameOf({ root: opts.cwd }),
      interactive: process.stdin.isTTY === true,
    });

    if (!choice.ok) {
      process.stderr.write(`vulcan init: ${choice.error}\n`);

      return ExitCodes.USAGE;
    }

    if (choice.note !== undefined) {
      process.stderr.write(`${choice.note}\n`);
    }

    key = choice.key;
  }

  const result = ProjectScaffold.scaffold({ root: opts.cwd, key });

  for (const entry of result.entries) {
    process.stderr.write(`  ${entry.status.padEnd(8)} ${entry.subject}\n`);
  }

  let installCode: number = ExitCodes.OK;

  if (result.install.length > 0) {
    // Exact versions: V-S-05 pins what a project installs, and a range would drift on the next install.
    const args = ['add', '-d', '--exact', ...result.install];

    process.stderr.write(`installing ${result.install.join(' ')}\n`);
    const installExit = await SubProcess.runBun({
      cwd: opts.cwd,
      args,
      label: `bun ${args.join(' ')}`,
    });

    installCode = installExit;

    if (installCode !== ExitCodes.OK) {
      process.stderr.write(`vulcan init: 'bun ${args.join(' ')}' failed - run it yourself\n`);
    }
  }

  process.stderr.write('left to do:\n');
  result.todo.forEach((line, index) => process.stderr.write(`  ${index + 1}. ${line}\n`));

  await ProfilePrompt.offer({ root: opts.cwd });

  return installCode === ExitCodes.OK ? ExitCodes.OK : ExitCodes.FAILURE;
};
