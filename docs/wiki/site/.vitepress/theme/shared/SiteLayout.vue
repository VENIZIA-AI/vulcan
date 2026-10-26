<!--
  Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
  scripts/wiki-shared in VULCAN. Edit it there, never in a copy.

  The Layout of a wiki: the default theme's, with the version chip beside the title, the ecosystem
  switcher in the header and in the mobile menu, and the light and dark switch. `product` is the
  wiki's id (ignis, ardor, vulcan) and `version` the version its chip shows.
-->
<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import EcosystemSwitcher from './EcosystemSwitcher.vue';
import { provideThemeSwitch } from './toggle-appearance';

defineProps<{ product: string; version: string }>();

provideThemeSwitch();

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #nav-bar-title-after>
      <span class="site-version">{{ version }}</span>
    </template>
    <template #nav-bar-content-after>
      <EcosystemSwitcher :current="product" variant="popover" />
    </template>
    <template #nav-screen-content-after>
      <EcosystemSwitcher :current="product" variant="sheet" />
    </template>
  </Layout>
</template>
