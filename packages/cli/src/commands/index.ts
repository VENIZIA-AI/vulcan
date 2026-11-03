import { VulcanCommands } from '../common/index.ts';
import type { TCommandHandler } from '../common/index.ts';

/** Each command is loaded when it runs: `commit-check` is called by a git hook and must not load the commands that need atlas. */
export const COMMAND_LOADERS: Record<string, () => Promise<TCommandHandler>> = {
  [VulcanCommands.ADD]: () => import('./add.command.ts').then((module) => module.runAddCommand),
  [VulcanCommands.AGENTS]: () =>
    import('./agents.command.ts').then((module) => module.runAgentsCommand),
  [VulcanCommands.CLEAN]: () =>
    import('./clean.command.ts').then((module) => module.runCleanCommand),
  [VulcanCommands.COMMIT_CHECK]: () =>
    import('./commit-check.command.ts').then((module) => module.runCommitCheckCommand),
  [VulcanCommands.DOCTOR]: () =>
    import('./doctor.command.ts').then((module) => module.runDoctorCommand),
  [VulcanCommands.HELP]: () => import('./help.command.ts').then((module) => module.runHelpCommand),
  [VulcanCommands.INIT]: () => import('./init.command.ts').then((module) => module.runInitCommand),
  [VulcanCommands.PRESET]: () =>
    import('./preset.command.ts').then((module) => module.runPresetCommand),
  [VulcanCommands.PROFILE]: () =>
    import('./profile.command.ts').then((module) => module.runProfileCommand),
  [VulcanCommands.SYNC]: () => import('./sync.command.ts').then((module) => module.runSyncCommand),
  [VulcanCommands.UPGRADE]: () =>
    import('./upgrade.command.ts').then((module) => module.runUpgradeCommand),
  [VulcanCommands.VERSION]: () =>
    import('./help.command.ts').then((module) => module.runVersionCommand),
  [VulcanCommands.VISUALIZE]: () =>
    import('./visualize.command.ts').then((module) => module.runVisualizeCommand),
  [VulcanCommands.X]: () => import('./x.command.ts').then((module) => module.runXCommand),
};
