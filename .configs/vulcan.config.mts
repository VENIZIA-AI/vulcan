import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
  // W-00: a commit message never signs the commit as an agent. `vulcan sync` installs the commit-msg hook; CI runs the same check.
  commit: { message: { agent: { signature: 'deny' } } },
  // The colour of this project's pages (vulcan visualize); the generator has no colour of its own but a neutral slate.
  theme: { accent: '#8a5a20', accentDark: '#dead6a' },
  // The names on this repository's board page (vulcan board): the owner who answers asks, the title, the logo, and the faces of the Venizia agents.
  board: {
    owner: 'Phát',
    title: 'VENIZIA Board',
    logo: '.configs/board-logo.svg',
    agents: {
      'pnt-ignis-1': 'flame',
      'pnt-ardor-1': 'ember',
      'pnt-vulcan-1': 'rock',
    },
  },
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
    // One tag per release train, named like IGNIS and ARDOR name theirs (`<name>-v<version>`), so one tag ruleset,
    // `*-v*`, covers all three repositories.
    tagPattern: 'vulcan-v<version>',
    legacyTagPatterns: ['v<version>'],
    // The public key of this repository's CI, which signs the atlas index it publishes (the atlas-index job of the workflow deploy-docs.yml);
    // the private key is the Actions secret ATLAS_INDEX_KEY and exists nowhere else.
    index: { keys: ['RO71nPFQIg09uea7CNjO1QwvEOtD85330LwiiD0cPSQ='] },
  },
  // The release path is the owner's: an agent does not approve a waiting deployment or write a secret, an environment, a
  // ruleset, a branch protection, a collaborator role or the Actions permissions (rule W-08). A write to one of these through
  // `gh api` is an explicit -X POST, PUT, PATCH or DELETE or any body flag (gh turns -f, -F, --field, --raw-field and --input
  // into a POST); a read of the same endpoints asks nothing. Guards ask (guard-outside denies), and they are not a sandbox.
  guard: {
    // A write outside the project (V-B-08) is refused, not asked about: an ask interrupts the owner, or is approved unseen in an auto mode.
    outside: 'deny',
    writes: {
      commands: [
        {
          rule: 'V-W-03',
          what: 'writing a GitHub environment, secret, ruleset, protection or permission, or approving a deployment',
          pattern:
            '\\bgh\\s+api\\b(?=[^\\n]*\\b(?:environments|actions/secrets|actions/variables|actions/permissions|rulesets|branches/\\S+/protection|collaborators|pending_deployments)\\b)(?=[^\\n]*\\s(?:-X\\s*(?:POST|PUT|PATCH|DELETE)|-f|-F|--field|--raw-field|--input)\\b)',
          ignoreCase: true,
        },
        {
          rule: 'V-W-03',
          what: 'writing a GitHub Actions secret or variable',
          pattern: '\\bgh\\s+(?:secret|variable)\\s+(?:set|delete|remove)\\b',
        },
      ],
    },
  },
  // Placeholder paths in documentation examples and in one error message: no machine is named.
  doctor: {
    privateValues: {
      acknowledged: [
        {
          path: 'docs/wiki/content/**',
          kinds: ['machine-path'],
          reason: 'placeholder home-folder paths in examples',
        },
        {
          path: 'packages/cli/src/events/settings.ts',
          kinds: ['machine-path'],
          reason: 'a placeholder path in an error message',
        },
      ],
    },
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
