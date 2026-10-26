// https://vitepress.dev/guide/custom-theme
import { h } from 'vue';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

import pkg from '../../../../../packages/cli/package.json';
import './shared/fonts.css';
import './shared/tokens.css';
import './product.css';
import './design-tokens.css';
import './style.css';
import './shared/vp-map.css';
import './shared/doc.css';
import './shared/header.css';
import './shared/theme-switch.css';
import SiteLayout from './shared/SiteLayout.vue';
import HomeLanding from './HomeLanding.vue';

export default {
  extends: DefaultTheme,
  Layout: () => h(SiteLayout, { product: 'vulcan', version: pkg.version }),
  enhanceApp({ app }) {
    app.component('HomeLanding', HomeLanding);
  },
} satisfies Theme;
