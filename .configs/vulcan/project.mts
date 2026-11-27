import type { VulcanConfig } from '@venizia/vulcan';

export const project = {
  key: 'VULCAN',
  // In release order: okf, then atlas, then the cli that pins both.
  packages: [
    { dir: 'okf', name: '@venizia/vulcan-okf' },
    { dir: 'atlas', name: '@venizia/vulcan-atlas' },
    { dir: 'cli', name: '@venizia/vulcan' },
  ],
} satisfies VulcanConfig.ProjectType;
