import { ExitCodes, VULCAN_VERSION } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { CommandScopes } from './scopes.ts';
import { CommandTable } from './table.ts';

export const runHelpCommand = async (opts: ICommandContext): Promise<number> => {
  const [scope] = opts.args;

  if (scope === undefined) {
    process.stdout.write(CommandTable.helpText());

    return ExitCodes.OK;
  }

  if (!CommandScopes.scopes().includes(scope)) {
    process.stderr.write(
      `vulcan help: no scope '${scope}' - one of: ${CommandScopes.scopes().join(', ')}\n`,
    );

    return ExitCodes.USAGE;
  }

  process.stdout.write(CommandTable.scopeHelp({ scope }));

  return ExitCodes.OK;
};

export const runVersionCommand = async (): Promise<number> => {
  process.stdout.write(`${VULCAN_VERSION}\n`);

  return ExitCodes.OK;
};
