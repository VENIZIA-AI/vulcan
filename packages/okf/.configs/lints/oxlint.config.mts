import { defineConfig } from 'oxlint';
import { oxlintConfigs } from '@venizia/dev-configs/linters';

// Printing is the job of these files: the commands and the entries. stderr-logger.ts is the one writer of notes.
export default defineConfig({
  ...oxlintConfigs,
  overrides: [
    ...(oxlintConfigs.overrides ?? []),
    {
      files: [
        '**/src/*/command.ts',
        '**/src/entry/cli.ts',
        '**/src/entry/run.ts',
        '**/src/common/stderr-logger.ts',
      ],
      rules: { 'no-console': 'off' },
    },
  ],
});
