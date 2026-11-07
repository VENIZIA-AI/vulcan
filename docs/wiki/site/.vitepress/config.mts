import { defineConfig, type DefaultTheme } from 'vitepress';
import { writeChangelogFeed } from './theme/shared/changelog-loader.ts';
import { venziaCodeTheme } from './theme/shared/code-theme.ts';
import { WikiTheme } from './theme/shared/wiki-theme.ts';

// The colours of the wiki are the project's resolved theme, as `vulcan sync` wrote it to the manifest.
const THEME = WikiTheme.read({
  manifest: new URL('../../../../.agents/vulcan.manifest.json', import.meta.url).pathname,
});
const ACCENT_2 = '#c48a5a';

// The sidebars mirror IGNIS: Guides and References each have an index landing page.
const guidesSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Get Started',
    items: [
      { text: 'Overview', link: '/guides/' },
      { text: 'What is VULCAN', link: '/guides/get-started/what-is-vulcan' },
      { text: 'Adopt VULCAN', link: '/guides/get-started/adopt-vulcan' },
      { text: 'Your first day', link: '/guides/get-started/first-day' },
    ],
  },
  {
    text: 'Core Concepts',
    items: [
      { text: 'The project layer', link: '/guides/core-concepts/the-project-layer' },
      { text: 'The .agents folder', link: '/guides/core-concepts/the-agents-folder' },
      { text: 'Rules and slots', link: '/guides/core-concepts/rules-and-slots' },
      { text: 'Hooks and guards', link: '/guides/core-concepts/hooks-and-guards' },
      { text: 'The owner and the reply shape', link: '/guides/core-concepts/owner-and-replies' },
      { text: 'Work items', link: '/guides/core-concepts/work-items' },
      { text: 'The knowledge bundle', link: '/guides/core-concepts/knowledge-bundle' },
      { text: 'Atlas', link: '/guides/core-concepts/atlas' },
    ],
  },
];

const referencesSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'References',
    items: [
      { text: 'Overview', link: '/references/' },
      { text: 'vulcan.config', link: '/references/configuration/' },
      { text: 'Presets', link: '/references/presets' },
      { text: 'Interactive prompts', link: '/references/prompts' },
      { text: 'Coding agents', link: '/references/agents' },
      { text: 'Shipped skills', link: '/references/skills' },
    ],
  },
  {
    text: 'Commands',
    items: [
      { text: 'Overview', link: '/references/commands/' },
      { text: 'init', link: '/references/commands/init' },
      { text: 'add', link: '/references/commands/add' },
      { text: 'sync', link: '/references/commands/sync' },
      { text: 'agents', link: '/references/commands/agents' },
      { text: 'doctor', link: '/references/commands/doctor' },
      { text: 'commit-check', link: '/references/commands/commit-check' },
      { text: 'ci', link: '/references/commands/ci' },
      { text: 'event', link: '/references/commands/event' },
      { text: 'board', link: '/references/commands/board' },
      { text: 'clean', link: '/references/commands/clean' },
      { text: 'preset', link: '/references/commands/preset' },
      { text: 'profile', link: '/references/commands/profile' },
      { text: 'visualize', link: '/references/commands/visualize' },
    ],
  },
  { text: 'Rules', items: [{ text: 'Base rules and slots', link: '/references/rules' }] },
  {
    text: 'Hooks',
    items: [{ text: 'Overview', link: '/references/hooks/' }],
  },
  {
    text: 'okf',
    items: [
      { text: 'Overview', link: '/references/okf/' },
      { text: 'Renderers and coverage', link: '/references/okf/renderers' },
    ],
  },
  {
    text: 'atlas',
    items: [
      { text: 'Overview', link: '/references/atlas/' },
      { text: 'Tools', link: '/references/atlas/tools' },
      { text: 'Sources', link: '/references/atlas/sources' },
      { text: 'Prebuilt index', link: '/references/atlas/prebuilt-index' },
    ],
  },
];

export default defineConfig({
  // Served at the root of vulcan.venizia.ai.
  base: '/',
  appearance: 'dark',
  markdown: {
    // The code windows are dark in both themes (theme/shared/tokens.css), so one dark theme serves both: the
    // shared theme built from the accent on dark of the manifest theme (the value of --accent-on-dark).
    theme: venziaCodeTheme({ accent: THEME.dark.accent ?? '' }),
  },
  srcDir: '../content',
  outDir: './.vitepress/dist',
  title: 'VULCAN',
  description: 'The agentic-coding toolkit for VENIZIA projects',
  cleanUrls: true,
  // The changelog feed (RSS 2.0) is written next to the pages; the changelog has no sidebar, its index is the way in.
  buildEnd: async (config) => {
    await writeChangelogFeed({
      outDir: config.outDir,
      site: {
        title: 'VULCAN changelog',
        description: 'What changed in VULCAN, who is affected and what to do about it.',
        siteUrl: 'https://vulcan.venizia.ai',
      },
    });
  },
  head: [
    [
      'link',
      {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: 'VULCAN changelog',
        href: '/changelog.xml',
      },
    ],
    WikiTheme.head({ theme: THEME, accent2: ACCENT_2 }),
    // The home page and its terminal hide their reveal states only under this class, set before first paint.
    ['script', {}, "document.documentElement.classList.add('js');"],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { name: 'theme-color', content: '#E8930A' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    [
      'meta',
      { property: 'og:title', content: 'VULCAN - The agentic-coding toolkit for VENIZIA projects' },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Rules, hooks, a knowledge bundle and a search server for your coding agent, from one config file and one pinned devDependency.',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://vulcan.venizia.ai/' }],
    // Twitter / X card
    ['meta', { name: 'twitter:card', content: 'summary' }],
    [
      'meta',
      {
        name: 'twitter:title',
        content: 'VULCAN - The agentic-coding toolkit for VENIZIA projects',
      },
    ],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Rules, hooks, a knowledge bundle and a search server for your coding agent, from one config file and one pinned devDependency.',
      },
    ],
  ],
  lastUpdated: true,
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guides/', activeMatch: '/guides/' },
      { text: 'References', link: '/references/', activeMatch: '/references/' },
      { text: 'Changelog', link: '/changelogs/', activeMatch: '/changelogs/' },
    ],
    sidebar: {
      '/guides/': guidesSidebar,
      '/references/': referencesSidebar,
    },
    search: { provider: 'local' },
    outline: {
      level: [2, 3],
      label: 'On this page',
    },
    // The Venizia wordmark and the venizia.ai link are in the top bar (theme/shared/SiteBrand.vue, VeniziaLink.vue).
    socialLinks: [{ icon: 'github', link: 'https://github.com/VENIZIA-AI/vulcan' }],
    editLink: {
      pattern: 'https://github.com/VENIZIA-AI/vulcan/edit/develop/docs/wiki/content/:path',
      text: 'Edit this page on GitHub',
    },
    docFooter: {
      prev: 'Previous page',
      next: 'Next page',
    },
    darkModeSwitchLabel: 'Appearance',
    sidebarMenuLabel: 'Menu',
    returnToTopLabel: 'Return to top',
  },
});
