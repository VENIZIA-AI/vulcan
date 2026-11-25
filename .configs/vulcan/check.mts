import type { VulcanConfig } from '@venizia/vulcan';

export const check = {
  // Placeholder paths in documentation examples and in one error message: no machine is named.
  doctor: {
    privateValues: {
      acknowledged: [
        {
          path: 'docs/wiki/content/**',
          types: ['machine-path'],
          reason: 'placeholder home-folder paths in examples',
        },
        {
          path: 'packages/cli/src/events/settings.ts',
          types: ['machine-path'],
          reason: 'a placeholder path in an error message',
        },
      ],
    },
  },
} satisfies VulcanConfig.Check;
