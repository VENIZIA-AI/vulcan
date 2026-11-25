import type { VulcanConfig } from '@venizia/vulcan';

export const agent = {
  list: ['claude'],
  // The Venizia stack's rules (one script set per app, bun for scripts, verb-first names, const classes, await on its own line).
  packs: ['venizia'],
  rules: { 'V-W-01': 'on-user-word' },
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
} satisfies VulcanConfig.Agent;
