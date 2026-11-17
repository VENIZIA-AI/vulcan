import { ExitCodes, VULCAN_VERSION } from '../common/index.ts';
import { CommandTable } from './table.ts';

export const runHelpCommand = async (): Promise<number> => {
  process.stdout.write(CommandTable.helpText());

  return ExitCodes.OK;
};

export const runVersionCommand = async (): Promise<number> => {
  process.stdout.write(`${VULCAN_VERSION}\n`);

  return ExitCodes.OK;
};
