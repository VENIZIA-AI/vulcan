import {
  namingConventionConfigs,
  NoInlineAwaitRule,
  NoReturnAwaitRule,
  houseEslintPlugin,
} from '@venizia/dev-configs/linters';

// oxlint runs every other rule; ESLint keeps the one oxlint has no port of yet, and two async style rules.
export default [
  ...namingConventionConfigs,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: { venizia: houseEslintPlugin },
    rules: {
      [NoInlineAwaitRule.NAME]: NoInlineAwaitRule.build(),
      [NoReturnAwaitRule.NAME]: NoReturnAwaitRule.build(),
    },
  },
];
