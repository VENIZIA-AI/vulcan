import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
  knowledge: {
    bundle: '.agents/knowledge',
    changelogs: 'docs/wiki/content/changelogs',
  },
  // Validated today; read by atlas once project config lands (release order: okf, atlas, cli).
  atlas: {
    packages: {
      okf: '@venizia/vulcan-okf',
      atlas: '@venizia/vulcan-atlas',
      cli: '@venizia/vulcan',
    },
    tagPattern: 'v<version>',
  },
} satisfies VulcanConfig;
