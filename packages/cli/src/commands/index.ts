import { VulcanCommands } from '../common/index.ts';
import type { TCommandHandler } from '../common/index.ts';
import { runDoctorCommand } from './doctor.command.ts';
import { runHelpCommand, runVersionCommand } from './help.command.ts';
import { runInitCommand } from './init.command.ts';
import { runSyncCommand } from './sync.command.ts';
import { runUpgradeCommand } from './upgrade.command.ts';
import { runXCommand } from './x.command.ts';

/** The handler of every implemented command. */
export const COMMAND_HANDLERS: Record<string, TCommandHandler> = {
  [VulcanCommands.DOCTOR]: runDoctorCommand,
  [VulcanCommands.HELP]: runHelpCommand,
  [VulcanCommands.INIT]: runInitCommand,
  [VulcanCommands.SYNC]: runSyncCommand,
  [VulcanCommands.UPGRADE]: runUpgradeCommand,
  [VulcanCommands.VERSION]: runVersionCommand,
  [VulcanCommands.X]: runXCommand,
};
