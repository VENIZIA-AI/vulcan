// https://vitepress.dev/guide/custom-theme
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

import './design-tokens.css';

export default { extends: DefaultTheme } satisfies Theme;
