import { VulcanCommands } from '../common/index.ts';
import type { TCommandHandler } from '../common/index.ts';
import { runAddCommand } from './add.command.ts';
import { runAgentsCommand } from './agents.command.ts';
import { runCleanCommand } from './clean.command.ts';
import { runDoctorCommand } from './doctor.command.ts';
import { runHelpCommand, runVersionCommand } from './help.command.ts';
import { runInitCommand } from './init.command.ts';
import { runProfileCommand } from './profile.command.ts';
import { runSyncCommand } from './sync.command.ts';
import { runUpgradeCommand } from './upgrade.command.ts';
import { runVisualizeCommand } from './visualize.command.ts';
import { runXCommand } from './x.command.ts';

/** The handler of every implemented command. */
export const COMMAND_HANDLERS: Record<string, TCommandHandler> = {
  [VulcanCommands.ADD]: runAddCommand,
  [VulcanCommands.AGENTS]: runAgentsCommand,
  [VulcanCommands.CLEAN]: runCleanCommand,
  [VulcanCommands.DOCTOR]: runDoctorCommand,
  [VulcanCommands.HELP]: runHelpCommand,
  [VulcanCommands.INIT]: runInitCommand,
  [VulcanCommands.PROFILE]: runProfileCommand,
  [VulcanCommands.SYNC]: runSyncCommand,
  [VulcanCommands.UPGRADE]: runUpgradeCommand,
  [VulcanCommands.VERSION]: runVersionCommand,
  [VulcanCommands.VISUALIZE]: runVisualizeCommand,
  [VulcanCommands.X]: runXCommand,
};
