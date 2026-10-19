import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme } from 'vitepress';

const CHANGELOGS = fileURLToPath(new URL('../../content/changelogs', import.meta.url));

// Every dated entry, newest first, titled from its frontmatter - a new entry needs no sidebar edit.
const changelogItems = (): DefaultTheme.SidebarItem[] =>
  readdirSync(CHANGELOGS)
    .filter(file => /^\d{4}-\d{2}-\d{2}-.*\.md$/.test(file))
    .sort()
    .reverse()
    .map(file => {
      const title = /^title:\s*"?(.+?)"?\s*$/m.exec(readFileSync(`${CHANGELOGS}/${file}`, 'utf8'))?.[1];
      return { text: title ?? file, link: `/changelogs/${file.replace(/\.md$/, '')}` };
    });

export default defineConfig({
  // Served at the root of vulcan.venizia.ai.
  base: '/',
  srcDir: '../content',
  outDir: './.vitepress/dist',
  srcExclude: ['changelogs/template.md'],
  title: 'VULCAN',
  description: 'The agentic-coding toolkit for VENIZIA projects',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { name: 'theme-color', content: '#E8930A' }],
  ],
  lastUpdated: true,
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guides', link: '/guides/adopting-vulcan' },
      { text: 'Changelogs', link: '/changelogs/' },
    ],
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'Adopting VULCAN', link: '/guides/adopting-vulcan' },
          { text: 'Atlas', link: '/guides/atlas' },
        ],
      },
      {
        text: 'Changelogs',
        collapsed: true,
        items: [{ text: 'Overview', link: '/changelogs/' }, ...changelogItems()],
      },
    ],
    search: { provider: 'local' },
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: 'https://github.com/VENIZIA-AI/vulcan' }],
    editLink: {
      pattern: 'https://github.com/VENIZIA-AI/vulcan/edit/develop/docs/wiki/content/:path',
    },
  },
});
