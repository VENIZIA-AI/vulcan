import { defineConfig } from 'oxlint';
import { oxlintConfigs } from '@venizia/dev-configs/linters';

// Printing is the job of these files: a command, the checks and the hooks. The three files under src/hooks are blocking guards, which load with no other package.
export default defineConfig({
  ...oxlintConfigs,
  overrides: [
    ...(oxlintConfigs.overrides ?? []),
    {
      files: [
        '**/src/wiki/command.ts',
        '**/base/checks/wiki-source-links.ts',
        '**/base/hooks/*.ts',
        '**/src/hooks/guard-writes.ts',
        '**/src/hooks/hook-input.ts',
        '**/src/hooks/project-guards.ts',
      ],
      rules: { 'no-console': 'off' },
    },
  ],
});
