import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme } from 'vitepress';

const CHANGELOGS = fileURLToPath(new URL('../../content/changelogs', import.meta.url));

// Every dated entry, titled from its frontmatter and grouped by the date in its file name, newest
// date first - a new entry needs no sidebar edit.
const changelogGroups = (): DefaultTheme.SidebarItem[] => {
  const byDate = new Map<string, DefaultTheme.SidebarItem[]>();
  const files = readdirSync(CHANGELOGS)
    .filter((file) => /^\d{4}-\d{2}-\d{2}-.*\.md$/.test(file))
    .sort()
    .reverse();

  for (const file of files) {
    const date = file.slice(0, 10);
    const title = /^title:\s*"?(.+?)"?\s*$/m.exec(readFileSync(`${CHANGELOGS}/${file}`, 'utf8'))?.[1];
    const items = byDate.get(date) ?? [];

    items.push({ text: title ?? file, link: `/changelogs/${file.replace(/\.md$/, '')}` });
    byDate.set(date, items);
  }

  return [...byDate].map(([date, items]) => ({ text: date, collapsed: true, items }));
};

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
      { text: 'Rules and slots', link: '/guides/core-concepts/rules-and-slots' },
      { text: 'Hooks and guards', link: '/guides/core-concepts/hooks-and-guards' },
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
    ],
  },
  {
    text: 'Commands',
    items: [
      { text: 'Overview', link: '/references/commands/' },
      { text: 'init', link: '/references/commands/init' },
      { text: 'add', link: '/references/commands/add' },
      { text: 'sync', link: '/references/commands/sync' },
      { text: 'doctor', link: '/references/commands/doctor' },
    ],
  },
  { text: 'Rules', items: [{ text: 'Base rules and slots', link: '/references/rules' }] },
  {
    text: 'Hooks',
    items: [
      { text: 'Overview', link: '/references/hooks/' },
      { text: 'Remote-host guard', link: '/references/hooks/remote-host-guard' },
    ],
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
    ],
  },
];

const changelogsSidebar = (): DefaultTheme.SidebarItem[] => [
  {
    text: 'Overview',
    items: [
      { text: 'Introduction', link: '/changelogs/' },
      { text: 'Template', link: '/changelogs/template' },
    ],
  },
  {
    text: 'History',
    collapsed: false,
    items: changelogGroups(),
  },
];

export default defineConfig({
  // Served at the root of vulcan.venizia.ai.
  base: '/',
  appearance: 'dark',
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'one-dark-pro',
    },
  },
  srcDir: '../content',
  outDir: './.vitepress/dist',
  title: 'VULCAN',
  description: 'The agentic-coding toolkit for VENIZIA projects',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { name: 'theme-color', content: '#E8930A' }],
    // Fonts - preconnect
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    // Fonts - stylesheet
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap',
      },
    ],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'VULCAN - The agentic-coding toolkit for VENIZIA projects' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Rules, hooks, a knowledge bundle and a search server for your coding agent, from one config file and one pinned devDependency.',
      },
    ],
    ['meta', { property: 'og:image', content: '/og-image.png' }],
    ['meta', { property: 'og:url', content: 'https://vulcan.venizia.ai/' }],
    // Twitter / X card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'VULCAN - The agentic-coding toolkit for VENIZIA projects' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content: 'Rules, hooks, a knowledge bundle and a search server for your coding agent, from one config file and one pinned devDependency.',
      },
    ],
    ['meta', { name: 'twitter:image', content: '/og-image.png' }],
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
      '/changelogs/': changelogsSidebar(),
    },
    search: { provider: 'local' },
    outline: {
      level: [2, 3],
      label: 'On this page',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/VENIZIA-AI/vulcan' }],
    editLink: {
      pattern: 'https://github.com/VENIZIA-AI/vulcan/edit/develop/docs/wiki/content/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright (c) 2026 VENIZIA',
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
