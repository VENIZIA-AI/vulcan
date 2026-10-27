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
    // The public key of this repository's CI, which signs the atlas index it publishes (workflow atlas-index.yml);
    // the private key is the Actions secret ATLAS_INDEX_KEY and exists nowhere else.
    index: { keys: ['RO71nPFQIg09uea7CNjO1QwvEOtD85330LwiiD0cPSQ='] },
  },
  // A plugin this repository never uses still costs the skill listing: figma and chrome-devtools-mcp are 21 entries and
  // 8.4 KB of its 30 KB budget. `sync` merges this into .claude/settings.json; it overrides the person's own enabledPlugins here only.
  claude: {
    settings: {
      enabledPlugins: {
        'figma@claude-plugins-official': false,
        'chrome-devtools-mcp@claude-plugins-official': false,
      },
    },
  },
} satisfies VulcanConfig;
