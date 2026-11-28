import { defineConfig } from 'oxlint';
import { oxlintConfigs } from '@venizia/dev-configs/linters/oxlint';

// These two print what the site build found.
export default defineConfig({
  ...oxlintConfigs,
  overrides: [
    ...(oxlintConfigs.overrides ?? []),
    {
      files: [
        '**/site/.vitepress/theme/shared/build-check.ts',
        '**/site/.vitepress/theme/shared/search-index.ts',
      ],
      rules: { 'no-console': 'off' },
    },
  ],
});
