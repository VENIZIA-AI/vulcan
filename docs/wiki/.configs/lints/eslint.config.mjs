import { houseConfigs } from '@venizia/dev-configs/linters';

// oxlint runs the shared rules; ESLint runs the naming convention, the house rules and the async style rules. The
// VitePress site spells keys the theme API reads (`Layout`, `enhanceApp`), so the naming rule stays out of it.
export default [
  ...houseConfigs,
  { ignores: ['site/**'] },
  // A VitePress path loader imports the site's theme by a relative path: the wiki has no import map.
  {
    files: ['content/changelogs/upgrade/*.paths.ts'],
    rules: { 'venizia/no-parent-import': 'off' },
  },
];
