import { defineConfig } from 'oxlint';
import { oxlintConfigs } from '@venizia/dev-configs/linters';

// Printing is the job of these files: the commands and the entry.
export default defineConfig({
  ...oxlintConfigs,
  overrides: [
    ...(oxlintConfigs.overrides ?? []),
    {
      files: ['**/src/cli/main.ts', '**/src/*/command.ts'],
      rules: { 'no-console': 'off' },
    },
  ],
});
