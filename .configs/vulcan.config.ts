import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
  knowledge: {
    bundle: '.agents/knowledge',
    wiki: 'docs/wiki/content',
    changelogs: 'docs/wiki/content/changelogs',
  },
  // In release order: okf, then atlas, then the cli that pins both.
  packages: [
    { dir: 'okf', name: '@venizia/vulcan-okf' },
    { dir: 'atlas', name: '@venizia/vulcan-atlas' },
    { dir: 'cli', name: '@venizia/vulcan' },
  ],
  atlas: {
    tagPattern: 'v<version>',
  },
} satisfies VulcanConfig;
